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
