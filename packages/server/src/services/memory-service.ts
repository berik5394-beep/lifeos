import { prisma } from '../lib/prisma.js';

/**
 * Возвращает top-K активных (не истёкших) воспоминаний пользователя,
 * отсортированных по importance DESC, createdAt DESC.
 *
 * Подмешивается в системный промпт ассистента (chat/voice/conversation),
 * чтобы JARVIS "помнил" о людях, решениях и предпочтениях юзера между сессиями.
 *
 * Фаза 1: простой top-K — берём самые важные.
 * Фаза 2 заменит на vector retrieval (semantic relevance к текущему запросу).
 *
 * @param userId — пользователь
 * @param limit — сколько вытащить (по умолчанию 20 — не раздуваем context window)
 */
export async function getRelevantMemories(
  userId: string,
  limit = 20,
): Promise<{ type: string; content: string; importance: number }[]> {
  const now = new Date();
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
