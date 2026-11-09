import { addCivilDays } from './tz.js';

/**
 * «Когда» из русской фразы задачи — для быстрого пути без модели (аудит
 * 2026-11-09: «напомни в пятницу позвонить маме в 15:00» ставилось на СЕГОДНЯ
 * без времени, «в пятницу…» уезжало в название, пуш «за 30 мин» не приходил).
 *
 * Понимает: сегодня/завтра/послезавтра; (в/на/к) понедельник…воскресенье
 * («в следующую …» — мозгу); «20 ноября», «20.11»; «через N дней», «через неделю»;
 * время «в 15:00», «в 9:30», «к 18:00», «в 15 часов», «в 9 утра», «в 7 вечера».
 *
 * `{ invalid: true }` — дата/время названы, но не существуют («31 ноября»,
 * «в 25:00») или в прошлом («вчера»): быстрый путь НЕ решает — пусть мозг
 * переспросит. Без упоминания даты — сегодня (как раньше).
 */
export type RuWhen =
  | { invalid: false; date: string; time?: string; rest: string }
  | { invalid: true };

// НЕ \b — кириллица в JS-границах слова не работает. Границы — пробел/начало/конец.
const B = '(?:^|\\s)';
const E = '(?=$|[\\s,.!])';

const WEEKDAYS: Array<[RegExp, number]> = [
  [/понедельник/, 1],
  [/вторник/, 2],
  [/сред[ауы]/, 3],
  [/четверг/, 4],
  [/пятниц[ауы]/, 5],
  [/суббот[ауы]/, 6],
  [/воскресень[ея]/, 0],
];
const WEEKDAY_RE = new RegExp(
  `${B}(?:(?:в|во|на|к|до)\\s+)?(?:(?:следующ(?:ий|ую|ее|ей)|этот|эту|это)\\s+)?(понедельник|вторник|сред[ауы]|четверг|пятниц[ауы]|суббот[ауы]|воскресень[ея])${E}`,
  'i',
);

const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма[йя]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const DAY_MONTH_RE = new RegExp(`${B}(?:(?:на|к|до|в)\\s+)?(\\d{1,2})\\s+(${MONTHS.join('|')})[а-я]*${E}`, 'i');
const DAY_DOT_RE = new RegExp(`${B}(?:(?:на|к|до|в)\\s+)?(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?${E}`, 'i');
const IN_DAYS_RE = new RegExp(`${B}через\\s+(\\d{1,2}|один|два|три|пару)?\\s*(дн[ейя]|день|недел[юи])${E}`, 'i');
const TIME_RE = new RegExp(
  `${B}(?:в|к|до|на)\\s+(\\d{1,2})(?::|\\.)(\\d{2})${E}|${B}(?:в|к)\\s+(\\d{1,2})\\s*(час(?:а|ов)?|утра|дня|вечера|ночи)${E}`,
  'i',
);

const WORD_NUM: Record<string, number> = { один: 1, два: 2, три: 3, пару: 2 };

function weekdayOf(civil: string): number {
  return new Date(civil + 'T00:00:00Z').getUTCDay();
}

function validCivil(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Дата D.M без года: ближайшая будущая (сегодня включительно). */
function nearestYear(today: string, m: number, d: number, year?: number): string | null {
  const y0 = year ?? Number(today.slice(0, 4));
  const c = validCivil(y0, m, d);
  if (!c) return null;
  if (year !== undefined || c >= today) return c;
  return validCivil(y0 + 1, m, d);
}

function cut(text: string, match: RegExpMatchArray): string {
  const i = match.index ?? 0;
  return (text.slice(0, i) + ' ' + text.slice(i + match[0].length)).replace(/\s{2,}/g, ' ').trim();
}

export function parseRuWhen(text: string, today: string): RuWhen {
  let rest = text;
  let date: string | null = null;
  let time: string | undefined;

  if (/(?:^|\s)(?:вчера|позавчера)(?=$|[\s,.!])/i.test(rest)) return { invalid: true };

  const tm = rest.match(TIME_RE);
  if (tm) {
    let h: number;
    let min = 0;
    if (tm[1] !== undefined) {
      h = Number(tm[1]);
      min = Number(tm[2]);
    } else {
      h = Number(tm[3]);
      const part = (tm[4] ?? '').toLowerCase();
      if ((part === 'дня' || part === 'вечера') && h < 12) h += 12;
      if (part === 'ночи' && h === 12) h = 0;
    }
    if (h > 23 || min > 59) return { invalid: true };
    time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    rest = cut(rest, tm);
  }

  let m: RegExpMatchArray | null;
  if ((m = rest.match(new RegExp(`${B}послезавтра${E}`, 'i')))) {
    date = addCivilDays(today, 2);
    rest = cut(rest, m);
  } else if ((m = rest.match(new RegExp(`${B}(?:на\\s+)?завтра${E}`, 'i')))) {
    date = addCivilDays(today, 1);
    rest = cut(rest, m);
  } else if ((m = rest.match(new RegExp(`${B}(?:на\\s+)?сегодня${E}`, 'i')))) {
    date = today;
    rest = cut(rest, m);
  } else if ((m = rest.match(WEEKDAY_RE))) {
    const word = m[1].toLowerCase();
    const target = WEEKDAYS.find(([re]) => re.test(word))![1];
    let delta = (target - weekdayOf(today) + 7) % 7;
    if (delta === 0) delta = 7; // «в понедельник», сказанное в понедельник, — следующий
    // «в следующую пятницу» понимают по-разному (эта или через неделю) — пусть мозг уточнит.
    if (/следующ/i.test(m[0])) return { invalid: true };
    date = addCivilDays(today, delta);
    rest = cut(rest, m);
  } else if ((m = rest.match(DAY_MONTH_RE))) {
    const mi = MONTHS.findIndex((p) => new RegExp(`^${p}`, 'i').test(m![2]));
    date = nearestYear(today, mi + 1, Number(m[1]));
    if (!date) return { invalid: true };
    rest = cut(rest, m);
  } else if ((m = rest.match(DAY_DOT_RE))) {
    const yRaw = m[3] ? Number(m[3]) : undefined;
    const year = yRaw === undefined ? undefined : yRaw < 100 ? 2000 + yRaw : yRaw;
    date = nearestYear(today, Number(m[2]), Number(m[1]), year);
    if (!date) return { invalid: true };
    rest = cut(rest, m);
  } else if ((m = rest.match(IN_DAYS_RE))) {
    const n = m[1] ? (WORD_NUM[m[1].toLowerCase()] ?? Number(m[1])) : 1;
    const days = /недел/i.test(m[2]) ? n * 7 : n;
    date = addCivilDays(today, days);
    rest = cut(rest, m);
  }

  if (date !== null && date < today) return { invalid: true };
  rest = rest.replace(/^[,\s—-]+|[,\s—-]+$/g, '').trim();
  return { invalid: false, date: date ?? today, ...(time ? { time } : {}), rest };
}
