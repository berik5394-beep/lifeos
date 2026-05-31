/**
 * v2.0 Phase B4 — Hermes skill drafts via Claude haiku. Best-effort:
 * never throws; returns null on any failure. Mirrors user-axes/analyze-message.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import { registryToolNames } from '../../tools/index.js';
import { parseSkillSpec, type SkillSpec } from './types.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

function toolMenu(): string {
  return registryToolNames().join(', ');
}

const SYS = (menu: string): string => `Ты — конструктор НАВЫКОВ LifeOS. Навык —
это рецепт из СУЩЕСТВУЮЩИХ инструментов. Доступные инструменты: ${menu}.
Верни ТОЛЬКО валидный JSON формата:
{"name":"...","description":"когда применять","triggers":["фраза1","фраза2"],
"plan":[{"toolName":"имя-из-списка"}],"synthesis":"как слить результаты в один ответ"}
Используй ТОЛЬКО инструменты из списка. Без markdown, без пояснений.`;

async function draft(userContent: string): Promise<SkillSpec | null> {
  try {
    const res = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 600,
      system: SYS(toolMenu()),
      messages: [{ role: 'user', content: userContent }],
    });
    const block = res.content[0];
    if (!block || block.type !== 'text') return null;
    return parseSkillSpec(block.text);
  } catch (err) {
    console.warn('[hermes:builder] failed:',
      err instanceof Error ? err.message : err);
    return null;
  }
}

/** Explicit path: user asked "сделай навык, который ...". */
export async function buildSkillFromRequest(
  _userId: string,
  userText: string,
): Promise<SkillSpec | null> {
  return draft(`Сделай навык по запросу пользователя: «${userText}».`);
}

/** Proactive path: a recurring cluster of co-used tools → propose a skill. */
export async function proposeSkillFromPattern(
  _userId: string,
  toolCluster: string[],
): Promise<SkillSpec | null> {
  if (toolCluster.length < 2) return null;
  return draft(
    `Пользователь часто вызывает вместе: ${toolCluster.join(', ')}. ` +
    `Предложи удобный навык, объединяющий их.`,
  );
}
