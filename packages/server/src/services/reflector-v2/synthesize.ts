/**
 * Reflector v2 — Claude sonnet cross-tier synthesis → ONE keystone.
 * Best-effort: any failure → null (caller emits nothing; never fabricates).
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import { summariseFactsForPrompt, parseKeystone, type ReflectorV2Facts, type Keystone } from './types.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

const SYS = `Ты — рефлексирующий AI-друг LifeOS. Тебе дают КРОСС-СРЕЗ жизни
пользователя по разным слоям (личность, тон, настроение, привычки, финансы,
цели, навыки, связи). Выдай ОДИН самый важный keystone-вывод за период:
- что ГЛАВНОЕ сейчас,
- ПОЧЕМУ (обязательно свяжи минимум ДВА слоя — напр. «настроение просело И ты
  забросил привычку чтения, а это твоя годовая цель»),
- и ОДИН конкретный выполнимый шаг.
Учитывай личность (axes) и подстраивай тон. Будь конкретным, без воды.
Верни ТОЛЬКО валидный JSON:
{"message":"...","rationale":"короткое почему","severity":1-10,
"scopeTheme":"finance|health|habits|goals|identity|social|general",
"suggestedAction":null}
Без markdown, без пояснений.`;

export async function synthesizeKeystone(
  facts: ReflectorV2Facts,
  style: string,
): Promise<Keystone | null> {
  try {
    const content =
      `Стиль ассистента: ${style}.\n\nСрез жизни:\n${summariseFactsForPrompt(facts)}`;
    const res = await anthropic.messages.create({
      model: MODELS.sonnet,
      max_tokens: 600,
      system: SYS,
      messages: [{ role: 'user', content }],
    });
    const block = res.content[0];
    if (!block || block.type !== 'text') return null;
    return parseKeystone(block.text);
  } catch (err) {
    console.warn('[reflector-v2:synthesize] failed:',
      err instanceof Error ? err.message : err);
    return null;
  }
}
