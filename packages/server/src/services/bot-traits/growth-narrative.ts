/**
 * v2.0 Phase B2 — growth narrative: the bot articulates how it changed.
 *
 * Spec §7. Compares oldest snapshot vs current traits via Claude haiku,
 * producing a warm first-person story. Best-effort: no history → friendly
 * "still getting to know you"; Claude failure → template fallback.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import type { BotTraits, TraitSnapshot } from './types.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

const SYSTEM_PROMPT_TEMPLATE = (botName: string) =>
  `Ты — ${botName}, AI-друг. Опиши как ты ИЗМЕНИЛАСЬ в общении с
пользователем, сравнив свою персону ТОГДА и СЕЙЧАС.

ПРАВИЛА:
1. От первого лица («я стала...»).
2. 2-4 предложения. Тепло, искренне.
3. Описывай РЕАЛЬНУЮ дельту: что выросло, что осталось.
4. Без цифр в тексте — естественная речь.
5. Только русский. Без markdown.`;

export async function generateGrowthNarrative(
  oldest: TraitSnapshot | null,
  current: BotTraits,
  botName: string,
): Promise<string> {
  // No history yet — friendly placeholder, no Claude call.
  if (!oldest) {
    return 'Мы ещё узнаём друг друга. Со временем я подстроюсь под тебя — ' +
      'стану такой, какой тебе нужен друг.';
  }

  const fallback =
    'За это время я стала ближе к тебе — чувствую, что понимаю тебя лучше, ' +
    'чем в начале.';

  try {
    const userContent =
      `ТОГДА: warmth ${oldest.warmth.toFixed(2)}, directness ${oldest.directness.toFixed(2)}, ` +
      `humor ${oldest.humor.toFixed(2)}, playfulness ${oldest.playfulness.toFixed(2)}, ` +
      `depth ${oldest.depth.toFixed(2)}\n` +
      `СЕЙЧАС: warmth ${current.warmth.toFixed(2)}, directness ${current.directness.toFixed(2)}, ` +
      `humor ${current.humor.toFixed(2)}, playfulness ${current.playfulness.toFixed(2)}, ` +
      `depth ${current.relationshipDepth.toFixed(2)}`;

    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 300,
      system: SYSTEM_PROMPT_TEMPLATE(botName),
      messages: [{ role: 'user', content: userContent }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text' || !content.text.trim()) {
      return fallback;
    }
    return content.text.trim();
  } catch (err) {
    console.warn('[bot-traits:growth-narrative] failed:', err);
    return fallback;
  }
}
