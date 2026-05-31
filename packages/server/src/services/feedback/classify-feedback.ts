/**
 * v2.0 Phase B3 — Claude haiku classifier for USER reactions to bot replies.
 *
 * Best-effort: never throws. Any failure (429, network, parse) →
 * NO_REACTION. Cost ~$0.0001/call; only invoked when a previous bot
 * message exists. Mirrors user-axes/analyze-message.ts.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import {
  parseFeedbackResponse,
  NO_REACTION,
  type FeedbackResult,
  type ImplicitFlags,
} from './types.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

const FEEDBACK_SYSTEM_PROMPT = `Ты — анализатор РЕАКЦИЙ пользователя на ответы
ассистента LifeOS. Тебе дают последний ответ бота и ответ пользователя на него.
Определи, является ли сообщение пользователя РЕАКЦИЕЙ на манеру/содержание
бота, и что эта реакция говорит о личности.

ОСИ (те же 4, что в профиле личности):
- conflict_tolerance: реакция на прямоту/давление.
  «без нравоучений», «мягче», «не дави» → DOWN.
  «скажи как есть», «не сюсюкай», «будь прямее» → UP.
- introspection_depth: аппетит к рефлексии.
  «не философствуй», «давай конкретику», «по делу» → DOWN.
  «помоги понять почему», «копнём глубже» → UP.
- emotional_openness: к эмоциональному тону.
  «спасибо, поддержал», «то что нужно было услышать» → UP (слабо).
  «без эмоций», «по факту» → DOWN.
- self_discipline: обычно НЕ трогается реакцией — omit если нет явного.

DIMENSION (что именно не/зашло):
- tone: манера (жёстко/мягко/эмоционально).
- content: что посоветовал (не то / не помогло).
- understanding: бот не понял сути (особенно при isReAsk=true).
- style: прямая команда стиля («будь короче», «не философствуй»).

ПРАВИЛА:
1. Только валидный JSON. Без markdown, без объяснений.
2. Если это НЕ реакция на бота (просто новая тема) → isReaction=false,
   axisSignals=[]. Не выдумывай.
3. positive реакция → слабые сигналы (confidence ≤0.5).
4. negative/коррекция → сигналы сильнее (бот явно промахнулся).
5. delta [-1,1]: сильная коррекция ~0.12, средняя ~0.06, слабая ~0.02.
6. styleNote — короткая фраза-перевод для пользователя, напр.
   "ты попросил мягче — буду бережнее", или null.
7. moodDropped/isReAsk — лишь подсказки. Если текст явно нейтрален и
   позитивен, не делай негативный вывод только из флага.

ФОРМАТ:
{
  "isReaction": true,
  "valence": "negative",
  "dimension": "tone",
  "axisSignals": [
    {"axis":"conflict_tolerance","delta":-0.10,"confidence":0.8,
     "excerpt":"без нравоучений"}
  ],
  "styleNote": "ты попросил мягче — буду бережнее"
}

Если не реакция: {"isReaction": false, "valence":"neutral",
"dimension":"content", "axisSignals": [], "styleNote": null}`;

export async function classifyFeedback(
  botLastMsg: string,
  userMsg: string,
  flags: ImplicitFlags,
): Promise<FeedbackResult> {
  const bot = (botLastMsg ?? '').trim();
  const user = (userMsg ?? '').trim();
  if (bot.length === 0 || user.length === 0) return NO_REACTION;

  const content =
    `[БОТ]: ${bot.slice(0, 1000)}\n` +
    `[ЮЗЕР]: ${user.slice(0, 1000)}\n` +
    `[СИГНАЛЫ]: moodDropped=${flags.moodDropped} isReAsk=${flags.isReAsk}`;

  try {
    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 512,
      system: FEEDBACK_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });
    const block = response.content[0];
    if (!block || block.type !== 'text') return NO_REACTION;
    return parseFeedbackResponse(block.text);
  } catch (err) {
    console.warn('[feedback:classify] failed:',
      err instanceof Error ? err.message : err);
    return NO_REACTION;
  }
}
