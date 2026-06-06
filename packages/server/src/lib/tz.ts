/**
 * B.5 — таймзоно-корректный date-math (фундамент).
 *
 * Аудит 2.7: весь код считает «сегодня» через серверный UTC
 * (setHours(0,0,0,0) / toISOString().slice(0,10)). На Railway это UTC,
 * а юзер в Алматы (UTC+5): после 19:00 локально сервер уже считает
 * «завтра» → события/брифинг/стрик/пет уезжают на день.
 *
 * Здесь — чистые хелперы (Intl, без внешних зависимостей; в Node
 * полный ICU). Это ФУНДАМЕНТ: пер-модульная миграция 85 call-sites
 * (читать И писать день в одной конвенции) — отдельная
 * дисциплинированная работа, т.к. БД хранит @db.Date как UTC-полночь
 * и менять только чтение = промах по строкам (аудит сам предупреждает
 * про несогласованность).
 *
 * Контракт: при невалидной/неизвестной tz — фолбэк на UTC (никогда
 * не бросаем, date-math не должен падать).
 */

const FALLBACK_TZ = 'UTC';

function safeTz(tz: string | null | undefined): string {
  if (!tz) return FALLBACK_TZ;
  try {
    // бросит RangeError на мусорной зоне
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_TZ;
  }
}

/**
 * App-дефолт пояса при «нет инфо о юзере» (KZ-база). Отличается от
 * FALLBACK_TZ ('UTC', чисто для date-math, чтобы не бросать).
 */
export const DEFAULT_TZ = 'Asia/Almaty';

/** true, если строка — валидная зона (Intl не бросает). Для валидации X-Timezone. */
export function isValidIanaTz(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Локальные дата+время юзера строкой («пятница, 6 июня 2026 г., 19:42»).
 * Для впрыска блока «СЕЙЧАС» в системный промпт — LLM не имеет часов.
 */
export function localNowString(
  tz: string | null | undefined,
  at: Date = new Date(),
): string {
  const zone = safeTz(tz);
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/** Смещение зоны от UTC в мс на момент `date` (учитывает DST). */
function tzOffsetMs(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUTC - date.getTime();
}

/** Локальная календарная дата юзера в формате YYYY-MM-DD. */
export function localDateStr(tz: string, at: Date = new Date()): string {
  const zone = safeTz(tz);
  // en-CA даёт ISO-подобный YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * UTC-инстант, соответствующий 00:00 ЛОКАЛЬНОГО дня юзера, в который
 * попадает `at`. Корректно для зон с/без DST (KZ — без DST → точно).
 */
export function localDayStartUTC(tz: string, at: Date = new Date()): Date {
  const zone = safeTz(tz);
  const [y, m, d] = localDateStr(zone, at).split('-').map(Number);
  const guessUTC = Date.UTC(y, m - 1, d, 0, 0, 0);
  const off = tzOffsetMs(zone, new Date(guessUTC));
  return new Date(guessUTC - off);
}

/**
 * ЗНАЧЕНИЕ для колонки @db.Date = UTC-полночь КАЛЕНДАРНОЙ даты юзера.
 *
 * КРИТИЧНО (баг 2026-06-06): localDayStartUTC возвращает реальный UTC-инстант
 * локальной полуночи (для Almaty = 19:00 предыдущего дня UTC). Postgres @db.Date
 * берёт UTC-дату этого инстанта → пишет civil−1 (вчера). Для @db.Date нужна
 * UTC-полночь самой календарной даты (T00:00Z того же числа), что и даёт эта
 * функция. localDayStartUTC оставляем ТОЛЬКО для сравнения таймстемпов (createdAt).
 */
export function localDateOnlyUTC(tz: string, at: Date = new Date()): Date {
  return new Date(localDateStr(safeTz(tz), at) + 'T00:00:00Z');
}

/** @db.Date-значение из УЖЕ календарной строки 'YYYY-MM-DD' (без tz-round-trip). */
export function dateOnlyUTC(civilDate: string): Date {
  return new Date(civilDate + 'T00:00:00Z');
}

/** @db.Date-значение = UTC-полночь 1-го числа КАЛЕНДАРНОГО месяца юзера (аналог localDateOnlyUTC). */
export function localMonthOnlyUTC(tz: string, at: Date = new Date()): Date {
  return new Date(localDateStr(safeTz(tz), at).slice(0, 8) + '01T00:00:00Z');
}

/**
 * UTC-инстант 00:00 ЛОКАЛЬНОГО 1-го числа месяца, в который попадает
 * `at`. Копия localDayStartUTC, но день=1. DST-устойчиво (re-нормализация
 * смещения; KZ без DST → точно). Для границ месяца в month-load.
 */
export function localMonthStartUTC(tz: string, at: Date = new Date()): Date {
  const zone = safeTz(tz);
  const [y, m] = localDateStr(zone, at).split('-').map(Number);
  const guessUTC = Date.UTC(y, m - 1, 1, 0, 0, 0);
  const off = tzOffsetMs(zone, new Date(guessUTC));
  return new Date(guessUTC - off);
}

/** Локальный час юзера 0..23 (R11 тихие часы — не серверный UTC). */
/**
 * Phase 7 P4 (E) — день недели в локальной tz юзера.
 * Возвращает 0=Sunday, 1=Monday, ..., 6=Saturday (как Date.getDay()).
 * Используется gating-проверками типа "только воскресенье"
 * (weekly_summary). Раньше new Date().getDay() возвращал server day —
 * для Almaty юзера в воскресенье 00:00-05:00 локально server думал
 * субботу (UTC). Bug.
 */
export function localDayOfWeek(tz: string, at: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz(tz),
    weekday: 'short',
  }).format(at);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[fmt] ?? 0;
}

export function localHour(tz: string, at: Date = new Date()): number {
  const zone = safeTz(tz);
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(at),
  );
}

/**
 * Phase 7 P3 — стабильный «slot» сегодняшнего дня на указанный час
 * (минута=0) ЛОКАЛЬНО для tz юзера, как UTC-инстант. Используется
 * proactive-scheduler'ом для дедупа уведомлений «1/день в HH:00».
 *
 * Pattern замены устаревшего `daySlot(hour)` (который делал
 * `new Date().setHours(...)` — server local time, для Алматы юзера
 * слот 14:00 фактически = 19:00 локально). Симметрично с
 * `timeToDate("HH:MM", tz)`, но удобнее для целых часов.
 */
export function localDaySlot(hour: number, tz: string, at: Date = new Date()): Date {
  // Часовой UTC-инстант: полночь сегодняшнего дня в tz + hour часов.
  return new Date(localDayStartUTC(tz, at).getTime() + hour * 3_600_000);
}

/**
 * "HH:MM" в локальной таймзоне юзера. Phase 7 P1 DND.
 * Стабильный формат для сравнения с User.quietHoursStart/End (тоже "HH:MM").
 */
export function localTimeStr(tz: string, at: Date = new Date()): string {
  const zone = safeTz(tz);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh}:${mm}`;
}

/**
 * Phase 7 P1 — DND quiet hours check.
 *
 * Если оба null/undefined → DND off, return false.
 * Если start == end → trivially false (нулевой интервал).
 * Если start < end (например 13:00→17:00) → линейный интервал.
 * Если start > end (например 23:00→08:00) → интервал ЧЕРЕЗ полночь:
 *   "сейчас" попадает если now >= start ИЛИ now <= end.
 *
 * Сравнение лексикографическое на "HH:MM" — корректно потому что
 * h23-формат (zero-padded). Не парсим в Date — избегаем tz-edge.
 *
 * Format validation upstream: ожидаем "HH:MM" 5 chars. Невалидный
 * формат → DND ignored (return false) — graceful, не падаем.
 */
export function isInQuietHours(
  start: string | null | undefined,
  end: string | null | undefined,
  tz: string,
  at: Date = new Date(),
): boolean {
  if (!start || !end) return false;
  // Строгая валидация HH:MM: 00-23 для часов, 00-59 для минут.
  // Слабый regex \d{2}:\d{2} пропускает "25:99" → cross-midnight
  // ветка некорректно возвращает true.
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!valid.test(start) || !valid.test(end)) return false;
  if (start === end) return false;
  const now = localTimeStr(tz, at);
  if (start < end) {
    return now >= start && now < end;
  }
  // cross-midnight: start > end (23:00→08:00)
  return now >= start || now < end;
}

/** UTC-инстант начала дня `n` дней назад относительно локального дня. */
export function localDayStartUTCOffset(
  tz: string,
  daysAgo: number,
  at: Date = new Date(),
): Date {
  const todayStart = localDayStartUTC(tz, at);
  const shifted = new Date(todayStart);
  shifted.setUTCDate(shifted.getUTCDate() - daysAgo);
  // повторная нормализация на случай DST-перехода в окне
  return localDayStartUTC(tz, new Date(shifted.getTime() + 12 * 3600_000));
}
