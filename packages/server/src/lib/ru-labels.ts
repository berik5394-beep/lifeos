/**
 * Русские подписи ключей для того, что видит человек (экспорт CSV/PDF):
 * в БД лежат ключи (food, work, high), в файле должны быть «Еда», «Работа».
 * Незнакомый ключ показываем как есть (пользовательская категория).
 */
const EXPENSE: Record<string, string> = {
  food: 'Еда', transport: 'Транспорт', entertainment: 'Развлечения', clothing: 'Одежда',
  health: 'Здоровье', home: 'Дом', other: 'Прочее',
};
const TASK: Record<string, string> = {
  work: 'Работа', personal: 'Личное', health: 'Здоровье', finance: 'Финансы', education: 'Образование', home: 'Дом',
};
const PRIORITY: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Очень высокий' };
const HABIT: Record<string, string> = { health: 'Здоровье', work: 'Работа', personal: 'Личное' };
const FREQUENCY: Record<string, string> = { daily: 'Каждый день', weekly: 'Каждую неделю', weekdays: 'По будням', weekends: 'По выходным' };

const pick = (map: Record<string, string>) => (key: string | null | undefined): string =>
  key ? (map[key] ?? key) : '';

export const expenseCategoryLabel = pick(EXPENSE);
export const taskCategoryLabel = pick(TASK);
export const priorityLabel = pick(PRIORITY);
export const habitCategoryLabel = pick(HABIT);
export const frequencyLabel = pick(FREQUENCY);
