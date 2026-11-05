import { addCivilDays } from '../../lib/tz.js';

/** Сделки: стадии воронки и follow-up по умолчанию. Чистое (без БД). */
export const DEAL_STAGES = ['new', 'talks', 'proposal', 'contract', 'won', 'lost'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const OPEN_STAGES = ['new', 'talks', 'proposal', 'contract'] as const;
export type OpenStage = (typeof OPEN_STAGES)[number];

export const STAGE_LABEL: Record<DealStage, string> = {
  new: 'Новая',
  talks: 'Переговоры',
  proposal: 'КП отправлено',
  contract: 'Договор/оплата',
  won: 'Выиграна',
  lost: 'Проиграна',
};

const DEFAULT_STEP: Record<OpenStage, { days: number; text: string }> = {
  new: { days: 2, text: 'связаться' },
  talks: { days: 5, text: 'следующий контакт' },
  proposal: { days: 3, text: 'спросить ответ по КП' },
  contract: { days: 3, text: 'проверить оплату' },
};

export function isDealStage(s: string): s is DealStage {
  return (DEAL_STAGES as readonly string[]).includes(s);
}

export function isOpenStage(s: string): s is OpenStage {
  return (OPEN_STAGES as readonly string[]).includes(s);
}

/** Порядок важен: «оплатил» (won) раньше «оплат» (contract), отказ раньше всего. */
const SYNONYMS: Array<[RegExp, DealStage]> = [
  [/(проигр|отказ|слил|не\s+будет|^lost$)/, 'lost'],
  [/(выигр|оплатил|заплатил|купил|^won$)/, 'won'],
  [/(договор|сч[её]т|оплат|^contract$)/, 'contract'],
  [/(^|\s)кп($|\s)|коммерческ|предложени|^proposal$/, 'proposal'],
  [/(перегов|обсужда|общаем|^talks$)/, 'talks'],
  [/(нов|заявк|лид|^new$)/, 'new'],
];

/** Стадия из ключа или русской фразы; не поняли — null (не угадываем). */
export function parseStage(raw: string): DealStage | null {
  const s = raw.trim().toLowerCase().replace(/ё/g, 'е');
  if (!s) return null;
  if (isDealStage(s)) return s;
  for (const [re, stage] of SYNONYMS) if (re.test(s)) return stage;
  return null;
}

/** Следующий шаг по умолчанию при входе в стадию (civil-дата YYYY-MM-DD). */
export function defaultNextStep(stage: DealStage, todayCivil: string): { date: string; text: string } | null {
  if (!isOpenStage(stage)) return null;
  const d = DEFAULT_STEP[stage];
  return { date: addCivilDays(todayCivil, d.days), text: d.text };
}
