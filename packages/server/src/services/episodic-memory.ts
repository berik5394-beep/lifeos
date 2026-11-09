import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import type { Memory } from '@prisma/client';
import { shouldOverwriteContent, computeExpiresAt, mergeDetails } from './memory-service.js';
import { embedDocument, embeddingsEnabled, toVectorLiteral } from './embeddings.js';

/**
 * v2.0 Tier 2 — Episodic Memory.
 *
 * События во времени с validity windows (Graphiti pattern):
 * - validAt: когда event случился (default now)
 * - invalidAt: когда event стал недействителен (null = действующий)
 *
 * Builds on Memory table + Tier 2 extension fields (validAt/invalidAt/
 * entityRefs/mood — added in Task A1).
 *
 * Architecture: pure helpers (validateEventInput, clampMood) separately
 * from async prisma wrappers — следует existing pattern из
 * memory-service.ts (shouldOverwriteContent / computeExpiresAt pure +
 * captureMemory / getRelevantMemories async).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecordEventInput = {
  type: string;
  content: string;
  details?: string;
  entityRefs?: string[];
  /** -1..+1 emotional valence; clamped silently if out of range */
  mood?: number;
  /** When event occurred; default now() */
  validAt?: Date;
  /** Optional explicit invalidation timestamp (e.g. event already cancelled when recorded). */
  invalidAt?: Date;
  /** 1-10; default 5 */
  importance?: number;
};

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB)
// ---------------------------------------------------------------------------

/**
 * Clamp mood value to [-1, +1] range. Undefined → undefined (no override).
 */
export function clampMood(mood: number | undefined): number | undefined {
  if (mood === undefined) return undefined;
  return Math.max(-1, Math.min(1, mood));
}

/**
 * Validate RecordEventInput. Throws Error with message if invalid.
 * Returns nothing on success.
 *
 * Rules:
 * - content must be non-empty (trimmed)
 * - type must be non-empty
 * - invalidAt (if provided) must be >= validAt
 * - importance (if provided) must be in [1, 10]
 */
export function validateEventInput(input: RecordEventInput): void {
  if (!input.type || input.type.trim().length === 0) {
    throw new Error('validateEventInput: type must be non-empty');
  }
  if (!input.content || input.content.trim().length === 0) {
    throw new Error('validateEventInput: content must be non-empty');
  }
  if (input.invalidAt && input.validAt && input.invalidAt < input.validAt) {
    throw new Error(
      `validateEventInput: invalidAt (${input.invalidAt.toISOString()}) cannot be before validAt (${input.validAt.toISOString()}) — validAt must precede invalidAt`,
    );
  }
  if (input.importance !== undefined) {
    if (input.importance < 1 || input.importance > 10) {
      throw new Error(`validateEventInput: importance must be in [1, 10], got ${input.importance}`);
    }
  }
}

// ---------------------------------------------------------------------------
// ОДНА ПАМЯТЬ M2 — единый писатель (writeMemory)
// ---------------------------------------------------------------------------

/**
 * Вход единого писателя. Объединяет legacy-факты ({type,content,details,
 * source,tags,importance}) и v2-episodic-поля (entityRefs/mood/validAt/
 * invalidAt) + knob `embed` (стоимость embedding).
 */
export type WriteMemoryInput = {
  type: string;
  content: string;
  details?: string | null;
  source?: string;
  sourceId?: string | null;
  tags?: string[];
  importance?: number;
  entityRefs?: string[];
  mood?: number;
  validAt?: Date;
  invalidAt?: Date;
  /** Условный embedding. undefined → по типу (см. shouldEmbed). */
  embed?: boolean;
};

/**
 * Стабильные типы сворачиваем дедупом (как legacy captureMemory).
 * Эпизодические (event/emotion/place/message/action-типы) — нет: это
 * разные события во времени.
 */
const STABLE_TYPES = new Set(['fact', 'preference', 'person', 'decision']);

/** Минимальный ts_rank для засчёта FTS-дедупа.
 *  Слабый матч (один общий токен, rank ≤ порог) — не обновляет чужую строку,
 *  проваливается в create.
 *  Калибровка (измерено на russian-tsvector): one-token-weak≈0.06, two-token≈0.10,
 *  genuine-reworded≈0.26, exact≈0.46. Порог 0.08 режет одно-токенный коинциденс,
 *  хранит реальные пере-формулировки. */
const MEM_DEDUP_MIN_RANK = 0.08;

/**
 * Дедуп в обе стороны (2026-11-09, чистка флагов вскрыла): поиск дублей шёл
 * только «новое ⊂ старое» (plainto_tsquery = И всех слов нового). Уточнение
 * факта («Любит кофе» → «Очень любит кофе по утрам», «Мама — Айгуль» →
 * «Маму зовут Айгуль») не находило старую запись → копились дубли. А точный
 * повтор короткой записи («Серик» дважды) резался порогом ранга (0.06 < 0.08).
 *
 * Правила:
 *  1. Точный повтор (регистр/пробелы/точка в конце не важны) — сливаем всегда.
 *  2. Новое ⊂ старое — как раньше, только при ранге > MEM_DEDUP_MIN_RANK.
 *  3. Старое ⊂ новое (уточнение) — если в старом ≥2 слова и оно покрывает
 *     ≥ половины слов нового: одно слово «Серик» не поглотит «Серик должен 20 000».
 */
export interface DedupCandidate {
  id: string;
  importance: number;
  tags: string[];
  details: string | null;
  rank: number;
  /** Новое ⊂ старое (все слова нового есть в старом). */
  fwd: boolean;
  /** Старое ⊂ новое (все слова старого есть в новом). */
  rev: boolean;
  /** Точный повтор после нормализации. */
  exact: boolean;
  /** Сколько разных слов (лексем) в старом. */
  oldLex: number;
}

export const MEM_REFINE_MIN_OLD_LEX = 2;
export const MEM_REFINE_MIN_COVERAGE = 0.5;

/** Нормализация для «точного повтора» — та же, что в SQL дедупа. */
export function normalizeMemoryText(t: string): string {
  return t.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!…\s]+$/u, '');
}

/** Чистое решение (тест без БД): с какой записью слить новую, или ни с какой. */
export function pickDedupTarget(cands: DedupCandidate[], newLex: number): DedupCandidate | null {
  const exact = cands.find((c) => c.exact);
  if (exact) return exact;
  const fwd = cands
    .filter((c) => c.fwd && Number(c.rank) > MEM_DEDUP_MIN_RANK)
    .sort((a, b) => Number(b.rank) - Number(a.rank))[0];
  if (fwd) return fwd;
  if (newLex <= 0) return null;
  const refine = cands
    .filter((c) => c.rev && c.oldLex >= MEM_REFINE_MIN_OLD_LEX && c.oldLex / newLex >= MEM_REFINE_MIN_COVERAGE)
    .sort((a, b) => b.oldLex - a.oldLex)[0];
  return refine ?? null;
}

/**
 * recall-ценные типы, которые эмбедим по умолчанию (semantic retrieval
 * окупается). Высокочастотные дешёвые action-события (`task_created`,
 * `expense_added`, …) сюда НЕ входят — им хватает FTS, embedding-бюджет
 * не тратим. `message` — сырой чат-факт, recall-ценный.
 */
const EMBED_DEFAULT_TYPES = new Set([
  'message',
  'fact',
  'preference',
  'person',
  'decision',
  'event',
]);

/**
 * Pure decision (тест без БД): эмбедить ли вход?
 *  - явный knob input.embed имеет приоритет;
 *  - иначе по типу: recall-ценные (EMBED_DEFAULT_TYPES) → true,
 *    высокочастотные action-события → false.
 */
export function shouldEmbed(input: {
  type: string;
  embed?: boolean;
  content?: string;
}): boolean {
  if (input.embed !== undefined) return input.embed;
  return EMBED_DEFAULT_TYPES.has(input.type);
}

/**
 * ОДНА ПАМЯТЬ M2 — ЕДИНЫЙ писатель в `Memory`.
 *
 * Вбирает лучшее из обоих legacy/v2:
 *  1. ДЕДУП (портирован из memory-service.captureMemory): для STABLE_TYPES
 *     ищем похожую запись того же типа русским FTS; если нашли —
 *     update-in-place (importance=max, merge tags/details, sparse-overwrite
 *     guard через shouldOverwriteContent, освежаем createdAt).
 *  2. CREATE с episodic-полями (validAt/invalidAt/entityRefs/mood/source/
 *     tags) + TTL default (computeExpiresAt) — как recordEvent + legacy.
 *  3. УСЛОВНЫЙ EMBEDDING (порт storeEmbedding): если shouldEmbed(input) и
 *     embeddingsEnabled() — UPDATE "Memory" SET embedding.
 *
 * Best-effort: НИКОГДА не бросает (top-level try/catch). На сбое возвращает
 * { id: '', action: 'skipped' } — горячий путь не падает (как сегодня
 * recordEvent/captureActivity/captureMemory best-effort).
 */
export async function writeMemory(
  userId: string,
  input: WriteMemoryInput,
): Promise<{ id: string; action: 'created' | 'updated' | 'skipped' }> {
  try {
    const content = input.content.slice(0, 500);
    const details = input.details?.slice(0, 2000) ?? null;
    const tags = (input.tags || []).slice(0, 10).map((t) => t.slice(0, 32));
    const importance = input.importance ?? 5;
    const source = input.source ?? 'v2-episodic';

    // --- 1. Дедуп (порт из captureMemory) для стабильных типов ---
    if (STABLE_TYPES.has(input.type)) {
      const norm = normalizeMemoryText(content);
      const cands = await prisma.$queryRaw<Array<DedupCandidate & { newLex: number }>>`
        SELECT m.id, m.importance, m.tags, m.details,
          ts_rank(to_tsvector('russian', coalesce(m.content, '')), plainto_tsquery('russian', ${content})) AS rank,
          (to_tsvector('russian', coalesce(m.content, '')) @@ plainto_tsquery('russian', ${content})) AS fwd,
          (to_tsvector('russian', ${content}) @@ plainto_tsquery('russian', coalesce(m.content, ''))) AS rev,
          (regexp_replace(regexp_replace(lower(btrim(coalesce(m.content, ''))), '\\s+', ' ', 'g'), '[.!…[:space:]]+$', '') = ${norm}) AS exact,
          length(to_tsvector('russian', coalesce(m.content, '')))::int AS "oldLex",
          length(to_tsvector('russian', ${content}))::int AS "newLex"
        FROM "Memory" m
        WHERE m."userId" = ${userId}
          AND m.type = ${input.type}
          -- Забытое («Неправда», supersede) — не цель дедупа: иначе новое
          -- знание сольётся в скрытую строку и тоже станет невидимым.
          -- Время — часы ПРИЛОЖЕНИЯ, как у писателя (forgetMemory ставит
          -- invalidAt = new Date()). С NOW() базы, отстающей хоть на 1 мс,
          -- только что забытое считалось живым (флейк 2026-11-08).
          AND (m."invalidAt" IS NULL OR m."invalidAt" > ${new Date()})
          AND (
            to_tsvector('russian', coalesce(m.content, '')) @@ plainto_tsquery('russian', ${content})
            OR to_tsvector('russian', ${content}) @@ plainto_tsquery('russian', coalesce(m.content, ''))
            OR regexp_replace(regexp_replace(lower(btrim(coalesce(m.content, ''))), '\\s+', ' ', 'g'), '[.!…[:space:]]+$', '') = ${norm}
          )
        ORDER BY rank DESC
        LIMIT 10;
      `;

      const existing = pickDedupTarget(cands, cands[0]?.newLex ?? 0);
      if (existing) {
        const mergedTags = Array.from(new Set([...(existing.tags || []), ...tags])).slice(0, 10);
        const merged = mergeDetails(existing.details, details);
        const ex = await prisma.memory.findUnique({
          where: { id: existing.id },
          select: { content: true },
        });
        const oldContent = ex?.content ?? '';
        const allowContentReplace = shouldOverwriteContent(oldContent, content);
        const newContent = allowContentReplace ? content : oldContent;
        console.warn(
          `[memory] UPDATE type=${input.type} id=${existing.id} ` +
            `oldLen=${oldContent.length} newLen=${content.length} ` +
            `contentReplaced=${allowContentReplace} (user=${userId})`,
        );
        const updateData: Prisma.MemoryUpdateInput = { content: newContent, details: merged, tags: mergedTags, importance: Math.max(existing.importance, importance) };
        await prisma.memory.update({ where: { id: existing.id }, data: updateData });
        await storeMemoryEmbedding(existing.id, newContent, merged, input);
        return { id: existing.id, action: 'updated' };
      }
      // Ни повтора, ни уточнения, ни сильного совпадения → новая запись ниже.
    }

    // --- 2. Create с episodic-полями + TTL default ---
    const validAt = input.validAt ?? new Date();
    const mood = clampMood(input.mood);
    const expiresAt = computeExpiresAt(input.type);
    const created = await prisma.memory.create({
      data: {
        userId,
        type: input.type,
        content,
        details,
        source,
        sourceId: input.sourceId ?? null,
        tags,
        importance,
        expiresAt,
        validAt,
        invalidAt: input.invalidAt ?? null,
        entityRefs: input.entityRefs ?? [],
        mood: mood ?? null,
      },
      select: { id: true },
    });
    await storeMemoryEmbedding(created.id, content, details, input);
    return { id: created.id, action: 'created' };
  } catch (err) {
    console.warn(
      '[memory] writeMemory failed:',
      err instanceof Error ? err.message : err,
    );
    return { id: '', action: 'skipped' };
  }
}

/**
 * Условный embedding (порт приватного storeEmbedding из memory-service.ts).
 * Эмбедим только если shouldEmbed(input) (knob/тип) И embeddingsEnabled().
 * Best-effort: сбой Voyage не валит запись (семантика опциональна).
 */
async function storeMemoryEmbedding(
  id: string,
  content: string,
  details: string | null,
  input: WriteMemoryInput,
): Promise<void> {
  if (!id) return;
  if (!shouldEmbed(input)) return;
  if (!embeddingsEnabled()) return;
  try {
    const vec = await embedDocument(details ? `${content}. ${details}` : content);
    if (!vec) return;
    await prisma.$executeRawUnsafe(
      'UPDATE "Memory" SET embedding = $1::vector WHERE id = $2',
      toVectorLiteral(vec),
      id,
    );
  } catch (err) {
    console.warn('[memory] embed store failed:', err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Async API (thin prisma wrappers — structural tests in *.test.ts)
// ---------------------------------------------------------------------------

/**
 * Record new episodic event.
 *
 * Validates input via validateEventInput (throws if invalid).
 * Clamps mood to [-1, +1] silently.
 *
 * @returns Created Memory row id.
 */
export async function recordEvent(
  userId: string,
  input: RecordEventInput,
): Promise<{ id: string }> {
  validateEventInput(input);

  // ОДНА ПАМЯТЬ M2: ЕДИНЫЙ писатель (дедуп + условный embed).
  // `embed` НЕ передаём → writeMemory.shouldEmbed решает по типу: 'message'
  // (сырой чат-факт) эмбедится, высокочастотные action-типы (task_created,
  // expense_added, …) — нет. Тем самым captureV2 и captureActivity идут
  // через него без правки их файлов.
  const res = await writeMemory(userId, {
    type: input.type,
    content: input.content,
    details: input.details ?? null,
    source: 'v2-episodic',
    importance: input.importance,
    entityRefs: input.entityRefs,
    mood: input.mood,
    validAt: input.validAt,
    invalidAt: input.invalidAt,
  });
  return { id: res.id };
}

/**
 * Mark event as invalid (e.g. «передумал увольняться»).
 * Default invalidAt = now().
 */
export async function invalidateEvent(
  userId: string,
  eventId: string,
  invalidAt: Date = new Date(),
): Promise<boolean> {
  // Только своё: чужой id — ничего не трогаем (false).
  const r = await prisma.memory.updateMany({
    where: { id: eventId, userId },
    data: { invalidAt },
  });
  return r.count > 0;
}

/** F2 floor: топик-матч обычно одно-токенный. Главная защита — единственный-
 *  сильный-матч; порог лишь отсекает near-zero шум. ИЗМЕРЕНО на тест-БД:
 *  легит топик-матч («кофе» vs «люблю кофе») = 0.0608 > 0.03; не-матч (другой
 *  стем «курение» vs «курить»; «город» vs «Алматы») = @@ FALSE, вне выборки. */
const SUPERSEDE_MIN_RANK = 0.03;

/**
 * F2 явная коррекция: найти ЕДИНСТВЕННУЮ сильную same-type не-инвалидированную
 * память по топику и инвалидировать (обратимо). 0 / >1 / слабый → null (НЕ прячем).
 */
export async function supersedeByTopic(
  userId: string,
  type: string,
  topic: string,
  excludeId: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string; rank: number }>>`
    SELECT m.id,
      ts_rank(to_tsvector('russian', coalesce(m.content, '')), plainto_tsquery('russian', ${topic})) AS rank
    FROM "Memory" m
    WHERE m."userId" = ${userId} AND m.type = ${type} AND m.id <> ${excludeId}
      AND m."invalidAt" IS NULL
      AND to_tsvector('russian', coalesce(m.content, '')) @@ plainto_tsquery('russian', ${topic})
    ORDER BY rank DESC
    LIMIT 3;`;
  const strong = rows.filter((r) => r.rank >= SUPERSEDE_MIN_RANK);
  if (strong.length !== 1) return null;
  await invalidateEvent(userId, strong[0].id);
  console.warn(`[memory] SUPERSEDE type=${type} topic="${topic}" invalidated=${strong[0].id} (user=${userId})`);
  return strong[0].id;
}

// ---------------------------------------------------------------------------
// rankBySignificance — pure significance-ranking helper (E2)
// ---------------------------------------------------------------------------

export type RankableMemory = {
  id: string;
  type: string;
  content: string;
  createdAt: Date;
  importance: number;
};

/** Pure: скор = importance + recency-бонус (≤2дн +2, ≤7дн +1); desc, тай-брейк по свежести. */
export function rankBySignificance<T extends RankableMemory>(
  rows: T[],
  limit: number,
  now: Date,
): T[] {
  const score = (r: T): number => {
    const ageDays = (now.getTime() - r.createdAt.getTime()) / 86_400_000;
    const recencyBonus = ageDays <= 2 ? 2 : ageDays <= 7 ? 1 : 0;
    return r.importance + recencyBonus;
  };
  return [...rows]
    .sort((a, b) => score(b) - score(a) || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, Math.max(1, limit));
}

/**
 * E2: кандидаты = свежие ∪ высоко-важные (оба с invalidAt/expiry-фильтрами,
 * как recentEvents), дедуп по id, ранжирование по значимости → топ-limit.
 */
export async function significantMemories(
  userId: string,
  limit = 6,
): Promise<Array<{ type: string; content: string; createdAt: Date }>> {
  const now = new Date();
  const [recent, important] = await Promise.all([
    prisma.memory.findMany({
      where: {
        userId,
        invalidAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { id: true, type: true, content: true, createdAt: true, importance: true },
    }),
    prisma.memory.findMany({
      where: {
        userId,
        invalidAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
      take: 10,
      select: { id: true, type: true, content: true, createdAt: true, importance: true },
    }),
  ]);
  const byId = new Map<string, RankableMemory>();
  for (const r of [...recent, ...important]) byId.set(r.id, r);
  return rankBySignificance([...byId.values()], limit, now).map(
    ({ type, content, createdAt }) => ({ type, content, createdAt }),
  );
}

/**
 * v2-натив reader недавней активности (шаг M3, заменяет legacy-чтение в чат-пути).
 * Свежие НЕ-инвалидированные, НЕ-протухшие (TTL) события по createdAt → главный
 * enrichment видит любой captureActivity сразу. БЕЗ зависимости от memory-service
 * (legacy на удаление). Type-агностично: новый тип события виден без проводки.
 */
export async function recentEvents(
  userId: string,
  limit = 6,
): Promise<Array<{ type: string; content: string; createdAt: Date }>> {
  const now = new Date();
  return prisma.memory.findMany({
    where: {
      userId,
      invalidAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(1, limit), 20),
    select: { type: true, content: true, createdAt: true },
  });
}

/**
 * Get events that reference a specific entity.
 * By default excludes invalidated events (invalidAt != null).
 */
export async function getEventsForEntity(
  userId: string,
  entityId: string,
  opts: {
    includeInvalid?: boolean;
    limit?: number;
  } = {},
): Promise<Memory[]> {
  return prisma.memory.findMany({
    where: {
      userId,
      entityRefs: { has: entityId },
      ...(opts.includeInvalid ? {} : { invalidAt: null }),
    },
    orderBy: { validAt: 'desc' },
    take: opts.limit ?? 50,
  });
}

/**
 * Most recent event referencing this entity (or null if none).
 * Excludes invalidated events.
 */
export async function lastEventForEntity(
  userId: string,
  entityId: string,
): Promise<Memory | null> {
  return prisma.memory.findFirst({
    where: {
      userId,
      entityRefs: { has: entityId },
      invalidAt: null,
    },
    orderBy: { validAt: 'desc' },
  });
}

/**
 * Number of (non-invalidated) events for entity in last N days.
 */
export async function entityFrequency(
  userId: string,
  entityId: string,
  periodDays: number,
): Promise<number> {
  const since = new Date(Date.now() - periodDays * 86_400_000);
  return prisma.memory.count({
    where: {
      userId,
      entityRefs: { has: entityId },
      invalidAt: null,
      validAt: { gte: since },
    },
  });
}
