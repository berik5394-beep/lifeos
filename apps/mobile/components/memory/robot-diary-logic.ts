/** Дневник робота (робот-друг, пункт 3) — чистая логика экрана. */
export interface DiaryEntry {
  day: string; // YYYY-MM-DD (локальный день пользователя)
  text: string;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function localYmd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** «Сегодня» / «Вчера» / «Среда, 4 ноября». */
export function diaryDayLabel(day: string, now: Date): string {
  if (day === localYmd(now)) return 'Сегодня';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === localYmd(y)) return 'Вчера';
  const [yy, mm, dd] = day.split('-').map(Number);
  if (!yy || !mm || !dd) return day;
  const d = new Date(yy, mm - 1, dd);
  const wd = WEEKDAYS[d.getDay()];
  const label = `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${dd} ${MONTHS[mm - 1]}`;
  return yy === now.getFullYear() ? label : `${label} ${yy}`;
}
