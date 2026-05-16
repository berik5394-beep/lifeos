import { prisma } from '../lib/prisma.js';
import {
  embedDocument,
  embedQuery,
  embeddingsEnabled,
  toVectorLiteral,
} from './embeddings.js';

/**
 * Phase 2.3: считает и сохраняет эмбеддинг записи (best-effort).
 * Не валит запись если Voyage недоступен — семантика опциональна.
 */
async function storeEmbedding(
  id: string,
  content: string,
  details: string | null,
): Promise<void> {
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

/**
 * Получает релевантные воспоминания юзера для подмешивания в промпт ассистента.
 *
 * Стратегия (Фаза 2a):
 *  - Если передан `query` (текст запроса юзера) — делаем Postgres full-text
 *    search по content+details+tags с русским конфигом, ранкуем гибрид
 *    fts_rank × 5 + importance/10 + бонус за свежесть.
 *  - Без `query` — fallback на top-K по importance (поведение Фазы 1).
 *
 * Это даёт query-aware retrieval без внешних embedding API. Когда у юзера
 * 500+ воспоминаний и захочется true semantic search — Фаза 2b добавит
 * pgvector + Voyage/OpenAI embeddings; интерфейс этой функции не изменится.
 *
 * Postgres русский text-search config умеет стемминг ("Серика" → "серик"),
 * так что запрос "что про серика" найдёт записи про "Серика", "Сериком" и т.д.
 *
 * Безопасность: используем параметризованный $queryRaw, никаких string concat
 * с пользовательским вводом.
 */

type MemoryRow = { type: string; content: string; importance: number };

/**
 * Фаза 2.2 — запись памяти с дедупликацией.
 *
 * Проблема: «хочу накопить миллион», сказанное трижды, раньше = три
 * записи, конкурирующие в выдаче. Стабильные типы (профильные факты,
 * предпочтения, люди, решения) теперь НЕ плодятся: ищем похожую запись
 * того же типа через FTS, и если нашли — обновляем её (берём бóльшую
 * важность, объединяем теги/детали, освежаем createdAt → запись снова
 * «свежая» для recency-ранжирования).
 *
 * Эпизодические типы (event/emotion/place) дублировать нормально —
 * это разные события во времени, их не сворачиваем.
 */
const STABLE_TYPES = new Set(['fact', 'preference', 'person', 'decision']);

export async function captureMemory(
  userId: string,
  m: {
    type: string;
    content: string;
    details?: string | null;
    source: string;
    sourceId?: string | null;
    tags?: string[];
    importance?: number;
  },
): Promise<'created' | 'updated'> {
  const content = m.content.slice(0, 500);
  const details = m.details?.slice(0, 2000) ?? null;
  const tags = (m.tags || []).slice(0, 10).map((t) => t.slice(0, 32));
  const importance = m.importance ?? 5;

  if (STABLE_TYPES.has(m.type)) {
    // Ищем похожую запись того же типа: FTS-совпадение по смыслу.
    const dup = await prisma.$queryRaw<Array<{ id: string; importance: number; tags: string[]; details: string | null }>>`
      SELECT m.id, m.importance, m.tags, m.details
      FROM "Memory" m
      WHERE m."userId" = ${userId}
        AND m.type = ${m.type}
        AND to_tsvector('russian', coalesce(m.content, '')) @@ plainto_tsquery('russian', ${content})
      ORDER BY ts_rank(
        to_tsvector('russian', coalesce(m.content, '')),
        plainto_tsquery('russian', ${content})
      ) DESC
      LIMIT 1;
    `;

    if (dup.length > 0) {
      const existing = dup[0];
      const mergedTags = Array.from(new Set([...(existing.tags || []), ...tags])).slice(0, 10);
      const merged = details ?? existing.details;
      await prisma.memory.update({
        where: { id: existing.id },
        data: {
          // Содержимое оставляем актуальное (последняя формулировка).
          content,
          details: merged,
          tags: mergedTags,
          importance: Math.max(existing.importance, importance),
          // Освежаем — повтор факта = он снова актуален (recency-ранк).
          createdAt: new Date(),
        },
      });
      await storeEmbedding(existing.id, content, merged);
      return 'updated';
    }
  }

  const created = await prisma.memory.create({
    data: {
      userId,
      type: m.type,
      content,
      details,
      source: m.source,
      sourceId: m.sourceId ?? null,
      tags,
      importance,
    },
    select: { id: true },
  });
  await storeEmbedding(created.id, content, details);
  return 'created';
}

export async function getRelevantMemories(
  userId: string,
  query: string | null,
  limit = 20,
): Promise<MemoryRow[]> {
  const now = new Date();

  // Без query — простой top-K
  if (!query || query.trim().length < 2) {
    const rows = await prisma.memory.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: { type: true, content: true, importance: true },
    });
    return rows;
  }

  // Phase 2.3 — ГИБРИД: FTS + семантика (pgvector cosine) + важность +
  // свежесть. Семантика ловит смысл без общих слов: «что про здоровье»
  // найдёт «болела спина после зала». Если эмбеддинг запроса получить
  // не удалось (нет ключа/сбой) — падаем на чистый FTS (ниже).
  if (embeddingsEnabled()) {
    const qvec = await embedQuery(query);
    if (qvec) {
      const hybrid = await prisma.$queryRawUnsafe<MemoryRow[]>(
        `
        SELECT m.type, m.content, m.importance
        FROM "Memory" m
        WHERE m."userId" = $1
          AND (m."expiresAt" IS NULL OR m."expiresAt" > NOW())
        ORDER BY (
          ts_rank(
            to_tsvector('russian',
              coalesce(m.content,'') || ' ' ||
              coalesce(m.details,'') || ' ' ||
              coalesce(array_to_string(m.tags,' '),'')
            ),
            plainto_tsquery('russian', $2)
          ) * 5.0
          + (m.importance::float / 10.0)
          + exp(- extract(epoch from (NOW() - m."createdAt")) / (86400.0 * 30.0))
          -- семантическая близость: 1 - cosine_distance, NULL→0 (старые
          -- досемантические записи не штрафуем — их несёт FTS).
          + COALESCE(1 - (m.embedding <=> $4::vector), 0) * 3.0
        ) DESC,
          m.importance DESC,
          m."createdAt" DESC
        LIMIT $3;
        `,
        userId,
        query,
        limit,
        toVectorLiteral(qvec),
      );
      return hybrid;
    }
  }

  // Fallback: FTS + importance + recency (без семантики).
  // Параметры: $1 userId, $2 query, $3 limit
  const result = await prisma.$queryRaw<MemoryRow[]>`
    SELECT
      m.type,
      m.content,
      m.importance
    FROM "Memory" m
    WHERE m."userId" = ${userId}
      AND (m."expiresAt" IS NULL OR m."expiresAt" > NOW())
    ORDER BY
      (
        ts_rank(
          to_tsvector('russian',
            coalesce(m.content, '') || ' ' ||
            coalesce(m.details, '') || ' ' ||
            coalesce(array_to_string(m.tags, ' '), '')
          ),
          plainto_tsquery('russian', ${query})
        ) * 5.0
        + (m.importance::float / 10.0)
        -- Фаза 2.2: временнóе затухание. Свежий факт при прочих равных
        -- весит выше старого (exp(-возраст_дней/30): ~1.0 сегодня,
        -- 0.72 через 10д, 0.37 через 30д). Не доминирует над явным
        -- FTS-совпадением, но решает ничьи в пользу актуального.
        + exp(
            - extract(epoch from (NOW() - m."createdAt"))
            / (86400.0 * 30.0)
          )
      ) DESC,
      m.importance DESC,
      m."createdAt" DESC
    LIMIT ${limit};
  `;

  return result;
}
