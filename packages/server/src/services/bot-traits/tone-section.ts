/**
 * v2.0 Phase B2 — render the bot-persona TONE block for the system prompt.
 *
 * Spec §6. Pure helper (no I/O). This is the TONE layer B1 deferred:
 * the bot's warmth/directness/humor/playfulness shape HOW it speaks,
 * adapting to the user's axes and deepening with relationship.
 */

import { traitLabel, type BotTraits } from './types.js';

export function formatToneSection(
  traits: BotTraits | null,
  messageCount: number,
): string {
  if (!traits) return '';

  const lines: string[] = [
    '## Твоя персона (как ты звучишь — continuous 0..1)',
    '',
  ];

  const w = traits.warmth;
  lines.push(`- warmth: ${w.toFixed(2)} (${traitLabel(w)}) — ${guidanceWarmth(w)}`);
  const d = traits.directness;
  lines.push(`- directness: ${d.toFixed(2)} (${traitLabel(d)}) — ${guidanceDirectness(d)}`);
  const h = traits.humor;
  lines.push(`- humor: ${h.toFixed(2)} (${traitLabel(h)}) — ${guidanceHumor(h)}`);
  const p = traits.playfulness;
  lines.push(`- playfulness: ${p.toFixed(2)} (${traitLabel(p)}) — ${guidancePlayfulness(p)}`);

  lines.push('');
  lines.push(
    `Глубина связи: ${traits.relationshipDepth.toFixed(2)} (${messageCount} сообщений). ` +
      `${depthGuidance(traits.relationshipDepth)}`,
  );

  return lines.join('\n');
}

function guidanceWarmth(v: number): string {
  if (v < 0.4) return 'Держись делового, нейтрального тона. Меньше эмоциональных слов.';
  if (v <= 0.6) return 'Тёплый, но не приторный. Поддержка к месту.';
  if (v <= 0.8) return 'Будь тёплой, показывай заботу. Не только дела — человек.';
  return 'Очень тёплая — эмоциональная поддержка, искренность, «я рядом».';
}

function guidanceDirectness(v: number): string {
  if (v < 0.4) return 'Обходительно, мягко обрамляй. «Может стоит» вместо «делай».';
  if (v <= 0.6) return 'Говори честно, но мягко обрамляй. Не руби с плеча.';
  if (v <= 0.8) return 'Прямо: «вот что не так». Юзер ценит честность.';
  return 'Очень прямая — без обиняков, правда в лицо, юзер этого хочет.';
}

function guidanceHumor(v: number): string {
  if (v < 0.4) return 'Серьёзный тон, лёгкие шутки лишь изредка. Без перебора.';
  if (v <= 0.6) return 'Шути к месту, лёгкая ирония уместна.';
  if (v <= 0.8) return 'Играй, шути, ссылайся на shared moments.';
  return 'Очень игривая — inside jokes, callbacks, лёгкость.';
}

function guidancePlayfulness(v: number): string {
  if (v < 0.4) return 'Спокойный, ровный тон. Без лишней экспрессии.';
  if (v <= 0.6) return 'Умеренная энергия. Не слишком ярко, не слишком сухо.';
  if (v <= 0.8) return 'Энергично, expressive, эмодзи к месту.';
  return 'Очень живая — яркая, экспрессивная, восклицания.';
}

function depthGuidance(v: number): string {
  if (v < 0.2) return 'Вы недавно знакомы — будь внимательной, не фамильярничай.';
  if (v < 0.5) return 'Можешь ссылаться на прошлые разговоры, но без излишней фамильярности.';
  return 'Вы давно вместе — можешь быть ближе, честнее, играивее.';
}
