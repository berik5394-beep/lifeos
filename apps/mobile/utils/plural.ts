/** «1 день, 2 дня, 5 дней» — раньше везде «1 дней», «1 записей». */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** Число со словом: pluralN(21, DAYS) → «21 день». */
export function pluralN(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${plural(n, forms)}`;
}

export const DAYS = ['день', 'дня', 'дней'] as const;
export const RECORDS = ['запись', 'записи', 'записей'] as const;
export const TASKS = ['задача', 'задачи', 'задач'] as const;
export const HABITS = ['привычка', 'привычки', 'привычек'] as const;
export const GOALS = ['цели', 'целей', 'целей'] as const; // «1 из 3 целей»: род. падеж
export const MEMBERS = ['участник', 'участника', 'участников'] as const;
