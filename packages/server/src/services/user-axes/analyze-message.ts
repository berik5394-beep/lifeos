/**
 * v2.0 Phase B1 — Per-message Claude haiku classifier for USER axes.
 *
 * Spec §5.3-5.4. Best-effort: never throws. On any failure (Claude 429,
 * network, JSON parse) → log warn + skip. Bot reply path unaffected.
 *
 * Cost: ~$0.0001 per call. For Berik's 24 msgs/day = ~$0.07/month.
 */

import { MODELS } from '../../lib/models.js';
import { createAnthropic } from '../../lib/anthropic.js';
import { parseAxisResponse } from './parse-response.js';
import { getUserAxesStore } from './index.js';

const anthropic = createAnthropic();

const AXIS_SYSTEM_PROMPT = `Ты — анализатор личности LifeOS. Из одного сообщения пользователя извлеки
сигналы по 4 осям личности.

ОСИ:
- self_discipline (0..1): склонность follow-through на обещания.
  UP: явные «сделал», «выполнил», «дочитал», consistency mentions.
  DOWN: «забыл», «не успел», «опять не получилось», repeated promises
  без follow-up.
- emotional_openness (0..1): готовность делиться чувствами.
  UP: emotional vocab («грустно», «злюсь», «переживаю»), body sensations,
  self-disclosure.
  DOWN: factual-only, «всё норм» при context негатива, deflection.
- conflict_tolerance (0..1): аппетит к pushback.
  UP: «не согласен», debating, «скажи как есть».
  DOWN: avoidance, defensive, abrupt topic-shift при challenge.
- introspection_depth (0..1): self-reflection.
  UP: «почему я», causal language, meta-cognition, past-self comparison.
  DOWN: descriptive без analysis, external attribution, present-focus only.

ПРАВИЛА:
1. Верни ТОЛЬКО валидный JSON. Без markdown, без объяснений.
2. Для КАЖДОЙ оси где есть evidence — return signal. Иначе omit ось.
3. delta range [-1.0, +1.0]. Strong signal ~0.10, medium ~0.05, weak ~0.02.
4. confidence [0, 1]. Высокая если сигнал явный и unambiguous.
5. excerpt — short fragment up to 100 chars показывающий signal.

ФОРМАТ:
{
  "signals": [
    {"axis": "self_discipline", "delta": -0.10, "confidence": 0.85, "excerpt": "опять не получилось"}
  ]
}

Если signals нет — верни {"signals": []}.

НЕ добавляй объяснений, только JSON.`;

/**
 * Analyze a single user message and persist any detected axis signals.
 * Returns silently — caller does not need to await for response correctness.
 * Always safe to call: any error is logged and swallowed.
 */
export async function analyzeMessage(
  userId: string,
  msgId: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;

  try {
    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 512,
      system: AXIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: trimmed }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      console.warn('[user-axes:analyzeMessage] empty/non-text Claude response');
      return;
    }

    const parsed = parseAxisResponse(content.text);
    if (parsed.signals.length === 0) return;

    await getUserAxesStore().recordSignals(
      userId,
      msgId,
      parsed.signals,
      'claude_classifier',
    );
  } catch (err) {
    console.warn(
      '[user-axes:analyzeMessage] failed:',
      err instanceof Error ? err.message : err,
    );
    // NEVER throw — caller (v2-capture parallel branch) must not break.
  }
}
