import { prisma } from '../lib/prisma.js';

/**
 * Трекинг интересов юзера. Раньше жил в chat.ts и вызывался из старого
 * /voice/chat. При миграции на оркестратор перестал вызываться (и был
 * удалён как мёртвый код). Возвращён сюда — теперь работает для ВСЕХ
 * интерфейсов (бот + приложение), потому что зовётся из handleMessage.
 *
 * Фоновый side-effect: по каждому сообщению определяем тему(ы) и
 * инкрементим счётчик. /user/interests показывает топ — JARVIS понимает
 * что юзера реально волнует (спорт/финансы/etc) и подстраивается.
 */

const TOPIC_KEYWORDS: Record<string, string[]> = {
  спорт: ['тренировк', 'упражнени', 'фитнес', 'бицепс', 'трицепс', 'мышц', 'зал', 'бег', 'йога', 'спорт', 'пресс', 'жим', 'присед', 'кардио', 'растяжк'],
  инвестиции: ['инвестиц', 'акци', 'крипто', 'биткоин', 'портфел', 'дивиденд', 'фондов', 'брокер', 'трейдинг', 'облигац'],
  кулинария: ['рецепт', 'приготов', 'блюд', 'кухн', 'ужин', 'обед', 'завтрак', 'выпечк', 'покушать', 'что приготовить'],
  здоровье: ['здоров', 'витамин', 'сон', 'стресс', 'медитац', 'давлен', 'головн', 'болит', 'лекарств', 'диет', 'калори', 'вес '],
  технологии: ['программ', 'код', 'разработ', 'приложени', 'сайт', 'javascript', 'python', 'react', ' api', 'баг', 'софт', 'гаджет'],
  бизнес: ['бизнес', 'стартап', 'маркетинг', 'продаж', 'клиент', 'прибыл', 'выручк', 'компани', 'предприниматель'],
  путешествия: ['путешеств', 'поездк', 'виз', 'отпуск', 'перел[её]т', 'отель', 'билет', 'туризм', 'рейс'],
  образование: ['учёб', 'учеб', 'экзамен', 'язык', 'курс', 'книг', 'наука', 'истори', 'философ', 'математик'],
  развлечения: ['фильм', 'сериал', 'музык', 'игр', 'кино', 'netflix', 'youtube', 'подкаст', 'аниме'],
};

function detectTopics(message: string): string[] {
  const lower = message.toLowerCase();
  const found: string[] = [];
  for (const [topic, kws] of Object.entries(TOPIC_KEYWORDS)) {
    if (kws.some((kw) => new RegExp(kw, 'i').test(lower))) found.push(topic);
  }
  return found;
}

/** Fire-and-forget: не блокирует ответ, ошибки глотает. */
export async function trackInterests(userId: string, message: string): Promise<void> {
  try {
    const topics = detectTopics(message);
    if (topics.length === 0) return;
    await Promise.all(
      topics.map((topic) =>
        prisma.userInterest.upsert({
          where: { userId_topic: { userId, topic } },
          update: { score: { increment: 1 }, lastMentioned: new Date() },
          create: { userId, topic, score: 1 },
        }),
      ),
    );
  } catch (err) {
    // C.12: трекинг не критичен (не валим запрос), но молчать нельзя.
    console.warn(
      '[interest] trackInterests failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
