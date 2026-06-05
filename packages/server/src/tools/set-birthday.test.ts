import { describe, it, expect } from 'vitest';
import { setBirthdayTool } from './set-birthday.js';

/**
 * Регрессия прод-бага (2026-06-05): LLM шлёт day/month СТРОКАМИ
 * ({"day":"25","month":"6"}), z.number() их отвергал → инструмент падал.
 * Фикс: z.coerce.number(). Эти тесты — гард на агентный путь (zod-парсинг).
 */
describe('set_birthday schema — coerces string numbers (как шлёт LLM)', () => {
  it('строковые day/month/year → числа', () => {
    const parsed = setBirthdayTool.schema.parse({
      person: 'Алуа',
      day: '25',
      month: '6',
      year: '1994',
    });
    expect(parsed).toEqual({ person: 'Алуа', day: 25, month: 6, year: 1994 });
  });
  it('числовые day/month по-прежнему ок', () => {
    const parsed = setBirthdayTool.schema.parse({ person: 'Мама', day: 21, month: 5 });
    expect(parsed).toEqual({ person: 'Мама', day: 21, month: 5 });
  });
  it('мусор в day → всё ещё отвергается', () => {
    expect(() => setBirthdayTool.schema.parse({ person: 'X', day: 'завтра', month: '5' })).toThrow();
  });
});
