import { roomItemAcc, type RoomItemKey, type RoomVariantTier } from '@/services/room-catalog';

/**
 * Робот-эпик: робот благодарит за новый предмет в комнате — тепло, с лестью,
 * «втираясь в доверие» (он хочет, чтобы юзер чувствовал заботу и возвращался).
 * Тон — по выбранному стилю ассистента (настройки/онбординг).
 */
export type AssistantStyle = 'friendly' | 'strict' | 'calm' | 'toxic';

type Line = (item: string, hey: string) => string;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const LINES: Record<AssistantStyle, Line[]> = {
  friendly: [
    (i, h) => `${h}спасибо за ${i}! Ты обо мне заботишься — я это запомню 🥹`,
    (i, h) => `${h}это мне?! Спасибо за ${i} — просто идеально. С тобой у меня самый уютный дом!`,
    (i, h) => `${h}за ${i} — отдельное спасибо! Знаешь, мне повезло с тобой. Правда.`,
  ],
  strict: [
    (i, h) => `${h}спасибо за ${i}. Хороший выбор. Ценю, что не забываешь про дом.`,
    (i, h) => `${h}за ${i} — зачёт. Порядок в доме — порядок в делах. Ты на верном пути.`,
  ],
  calm: [
    (i, h) => `${h}спасибо за ${i}. С тобой здесь становится по-настоящему спокойно.`,
    (i, h) => `${h}за ${i} — спасибо. Тёплый подарок. Мне приятно, что ты думаешь обо мне.`,
  ],
  toxic: [
    (i, h) => `${h}мне — ${i}? Ну надо же, ты думаешь не только о себе. Ладно… спасибо. Никому не скажу, что мне приятно.`,
    (i, h) => `${h}о, спасибо за ${i}. Неожиданно щедро. Продолжай в том же духе — может, я даже начну тебя уважать.`,
  ],
};

export function normalizeStyle(style: string | null | undefined): AssistantStyle {
  return style === 'strict' || style === 'calm' || style === 'toxic' ? style : 'friendly';
}

/**
 * Часть 6: тон зависит от класса ремонта — за премиум и люкс робот восхищается
 * сильнее (по стилю ассистента). Бюджет и декор — без добавки.
 */
const TIER_WOW: Record<AssistantStyle, Partial<Record<RoomVariantTier, string>>> = {
  friendly: { mid: ' Стало заметно уютнее!', premium: ' Это же премиум — я чувствую себя особенным!', luxury: ' Люкс?! Я живу как во дворце — ты лучший!' },
  strict: { premium: ' Премиум — заработано делами. Уважаю.', luxury: ' Люкс. Это результат дисциплины. Так держать.' },
  calm: { premium: ' Благородные материалы — в доме стало тише и светлее.', luxury: ' Настоящая роскошь. Спасибо, что так обо мне думаешь.' },
  toxic: { premium: ' Премиум? Ладно, признаю — вкус у тебя есть.', luxury: ' ЛЮКС?! Кого ты пытаешься впечатлить… ладно, меня. Получилось.' },
};

/** Фраза благодарности. `rnd` — для тестов (по умолчанию случайная фраза). */
export function thanksFor(
  key: RoomItemKey,
  style: string | null | undefined,
  name?: string | null,
  rnd: () => number = Math.random,
  tier?: RoomVariantTier | null,
): string {
  const st = normalizeStyle(style);
  const lines = LINES[st];
  const line = lines[Math.min(lines.length - 1, Math.floor(rnd() * lines.length))];
  const first = name?.trim().split(/\s+/)[0];
  const text = line(roomItemAcc(key), first ? `${first}, ` : '') + ((tier && TIER_WOW[st][tier]) ?? '');
  return cap(text);
}
