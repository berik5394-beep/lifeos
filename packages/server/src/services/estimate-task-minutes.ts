import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';

const DEFAULT_MINUTES = 30;
const MIN_MINUTES = 5;
const MAX_MINUTES = 480;

/** Достаёт минуты из ответа модели, клампит, дефолт при отсутствии. Чистая. */
export function parseMinutes(text: string): number {
  const m = text.match(/\d+/);
  if (!m) return DEFAULT_MINUTES;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(n)));
}

/**
 * Оценка времени задачи (минуты) — «сколько среднему человеку надо».
 * Best-effort haiku; на любой сбой → DEFAULT_MINUTES. Без БД.
 */
export async function estimateTaskMinutes(
  title: string,
  category: string | null,
): Promise<number> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return DEFAULT_MINUTES;
  try {
    const client = createAnthropic(apiKey);
    const resp = await client.messages.create({
      model: MODELS.haiku,
      max_tokens: 16,
      system:
        'Оцени, сколько МИНУТ среднему человеку нужно на задачу. ' +
        'Верни ТОЛЬКО целое число минут, без слов.',
      messages: [
        { role: 'user', content: `Задача: «${title}»${category ? ` (${category})` : ''}` },
      ],
    });
    const block = resp.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? parseMinutes(block.text) : DEFAULT_MINUTES;
  } catch {
    return DEFAULT_MINUTES;
  }
}
