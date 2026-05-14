import { prisma } from '../lib/prisma.js';

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

  // Query-aware: FTS + importance + recency.
  // ts_rank(...) даёт 0 если совпадений нет, поэтому где fts_rank=0 мы всё
  // равно показываем высоко-importance memory чтобы JARVIS видел контекст
  // (просто после явных совпадений).
  //
  // Параметры:
  //   $1 — userId
  //   $2 — query
  //   $3 — limit
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
      ) DESC,
      m.importance DESC,
      m."createdAt" DESC
    LIMIT ${limit};
  `;

  return result;
}
