import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { isV2ForgetEnabled } from '../lib/feature-flags.js';
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
 * Безопасность: параметризованные запросы ($queryRaw/$queryRawUnsafe);
 * строковые фрагменты (напр. forgetSql) — серверные КОНСТАНТЫ, никакого
 * string concat с пользовательским вводом (userId/query/limit — параметры).
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

/**
 * TTL defaults для эпизодических типов (2026-05-28 anti-noise).
 * Раньше: inspect-memory подтвердил 0/67 rows используют expiresAt
 * → память forever, накапливается шум. event/emotion по природе
 * transient (был на встрече / расстроен сегодня) — недели достаточно
 * чтобы попасть в weekly reflector, дальше пользы мало. Conservative:
 * только НОВЫЕ записи; существующие 67 rows не трогает (нет migration).
 * fact/preference/person/decision/place остаются forever.
 */
const TTL_DEFAULTS_DAYS: Record<string, number> = {
  event: 30,
  emotion: 14,
};

function computeExpiresAt(type: string, now = new Date()): Date | null {
  const days = TTL_DEFAULTS_DAYS[type];
  if (!days) return null;
  return new Date(now.getTime() + days * 86_400_000);
}
export { computeExpiresAt };

/**
 * Pure decision (тестируется без БД): можно ли заменить content
 * старой записи новым при dedup-UPDATE? Guard против sparse-overwrite
 * (Risk A из 2026-05-28 audit):
 *
 *  - Old: "Серик Жумабаев — брат, познакомились в школе" (45 chars)
 *  - New: "Серик" (5 chars, sparse mention) — FTS-match сработает
 *    (token-subset), но если перезаписать content — потеряем
 *    «брат + школа» (details сохраняются отдельно, но content —
 *    то что подмешивается в промпт ассистенту → деградация retrieval).
 *
 * Возвращает true только если новый content не значимо короче.
 * Иначе тегs/importance/details мержатся, но content остаётся старым.
 */
export function shouldOverwriteContent(
  oldContent: string,
  newContent: string,
): boolean {
  const oldLen = oldContent.length;
  const newLen = newContent.length;
  // Старая короткая (sparse) → новая длиннее = обогащение, разрешаем
  if (oldLen < 30) return true;
  // Новая значительно короче (< 70% старой длины) → отказ
  if (newLen < oldLen * 0.7) return false;
  return true;
}

// M3 Unit A (2026-06-06): legacy writer captureMemory удалён — единый писатель
// writeMemory (episodic-memory.ts) заменил его (FEATURE_V2_WRITE=all в проде).
// getRelevantMemories (legacy reader) ещё жив — Unit B.

export async function getRelevantMemories(
  userId: string,
  query: string | null,
  limit = 20,
): Promise<MemoryRow[]> {
  const now = new Date();

  // F1+F3 (за флагом FEATURE_V2_FORGET): из recall убираем сырые
  // type='message' строки (30% шума в проде) и чтим invalidAt
  // (инвалидированные записи скрыты — supersession). OFF → пусто →
  // SQL/where байт-идентичны сегодняшним во всех трёх путях.
  const forget = isV2ForgetEnabled(userId);
  const forgetSql = forget
    ? `AND m.type <> 'message' AND (m."invalidAt" IS NULL OR m."invalidAt" > NOW())`
    : '';

  // Без query — простой top-K
  if (!query || query.trim().length < 2) {
    const where: Prisma.MemoryWhereInput = {
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    if (forget) {
      where.type = { not: 'message' };
      where.AND = [{ OR: [{ invalidAt: null }, { invalidAt: { gt: now } }] }];
    }
    const rows = await prisma.memory.findMany({
      where,
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
          ${forgetSql}
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
  // $queryRawUnsafe с позиционными параметрами ($1 userId, $2 query,
  // $3 limit) — чтобы врезать ${forgetSql} за флагом. Сами параметры
  // по-прежнему биндятся (никакого concat пользовательского ввода);
  // forgetSql — серверная константа без user-input.
  const result = await prisma.$queryRawUnsafe<MemoryRow[]>(
    `SELECT m.type, m.content, m.importance
     FROM "Memory" m
     WHERE m."userId" = $1
       AND (m."expiresAt" IS NULL OR m."expiresAt" > NOW())
       ${forgetSql}
     ORDER BY (
       ts_rank(
         to_tsvector('russian',
           coalesce(m.content, '') || ' ' ||
           coalesce(m.details, '') || ' ' ||
           coalesce(array_to_string(m.tags, ' '), '')
         ),
         plainto_tsquery('russian', $2)
       ) * 5.0
       + (m.importance::float / 10.0)
       -- Фаза 2.2: временнóе затухание. Свежий факт при прочих равных
       -- весит выше старого (exp(-возраст_дней/30): ~1.0 сегодня,
       -- 0.72 через 10д, 0.37 через 30д). Не доминирует над явным
       -- FTS-совпадением, но решает ничьи в пользу актуального.
       + exp(- extract(epoch from (NOW() - m."createdAt")) / (86400.0 * 30.0))
     ) DESC,
       m.importance DESC,
       m."createdAt" DESC
     LIMIT $3;`,
    userId,
    query,
    limit,
  );

  return result;
}
