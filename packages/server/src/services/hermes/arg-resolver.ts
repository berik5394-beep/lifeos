/**
 * v2 Hermes H2 — resolve each skill step's args from the user's message.
 * Best-effort: on any failure, falls back to the step's stored argTemplate
 * (or {}). Pure parseArgsResponse is unit-tested without Claude.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import type { SkillStep } from './types.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

/** Defensive parse: always returns exactly `planLen` plain objects. */
export function parseArgsResponse(raw: string, planLen: number): Record<string, unknown>[] {
  const empties = (): Record<string, unknown>[] =>
    Array.from({ length: planLen }, () => ({}));
  if (!raw || !raw.trim()) return empties();
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return empties();
  }
  if (!Array.isArray(parsed)) return empties();
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < planLen; i++) {
    const el = parsed[i];
    out.push(el && typeof el === 'object' && !Array.isArray(el)
      ? (el as Record<string, unknown>) : {});
  }
  return out;
}

/**
 * Ask haiku to fill each step's args from the user's message. Returns one
 * args object per plan step. Best-effort: failure → per-step argTemplate ?? {}.
 */
export async function resolveSkillArgs(
  plan: SkillStep[],
  userMessage: string,
): Promise<Record<string, unknown>[]> {
  const fallback = (): Record<string, unknown>[] =>
    plan.map((s) => (s.argTemplate ? { ...s.argTemplate } : {}));
  if (plan.length === 0) return [];
  try {
    const steps = plan.map((s, i) => `${i + 1}. ${s.toolName}`).join('\n');
    const sys = `Ты заполняешь аргументы шагов навыка из сообщения пользователя.
Дан список шагов (инструменты по порядку) и сообщение. Верни ТОЛЬКО JSON-массив
объектов — по одному на КАЖДЫЙ шаг в том же порядке. В объекте — аргументы,
которые можно извлечь из сообщения для этого инструмента (например сумма,
описание, источник). Если для шага нечего извлечь — пустой объект {}.
Без markdown, без пояснений. Длина массива РОВНО ${plan.length}.`;
    const res = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 400,
      system: sys,
      messages: [{ role: 'user', content: `Шаги:\n${steps}\n\nСообщение: ${userMessage}` }],
    });
    const block = res.content[0];
    if (!block || block.type !== 'text') return fallback();
    const parsed = parseArgsResponse(block.text, plan.length);
    return plan.map((s, i) => ({ ...(s.argTemplate ?? {}), ...parsed[i] }));
  } catch (err) {
    console.warn('[hermes:arg-resolver] failed:',
      err instanceof Error ? err.message : err);
    return fallback();
  }
}
