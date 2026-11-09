import { describe, it, expect } from 'vitest';
import { withDoneSummary, quotedName } from './done-summary.js';

const task = (t: string) => ({ tool: 'create_task', message: `Задача "${t}" создана на 2026-11-09` });
const habit = (h: string) => ({ tool: 'create_habit', message: `Завёл привычку «${h}». Отмечай — буду считать серию.` });

describe('withDoneSummary — сделал, а сказать забыл', () => {
  it('живой случай 2026-11-09: две задачи и привычка, ответ только про цель', () => {
    const r = withDoneSummary('Теперь по цели на машину — какая сумма?', [task('Сдать отчёт'), task('Купить продукты'), habit('Утренняя зарядка')]);
    expect(r).toBe('Готово: задачи «Сдать отчёт», «Купить продукты»; привычка «Утренняя зарядка».\n\nТеперь по цели на машину — какая сумма?');
  });
  it('ответ уже называет всё — не дублируем', () => {
    const reply = 'Записала «Сдать отчёт» на сегодня.';
    expect(withDoneSummary(reply, [task('Сдать отчёт')])).toBe(reply);
  });
  it('регистр не важен', () => {
    expect(withDoneSummary('Поставила задачу сдать отчёт!', [task('Сдать отчёт')])).toBe('Поставила задачу сдать отчёт!');
  });
  it('не создание (трата, отметка) и без названия — ничего не добавляем', () => {
    expect(withDoneSummary('Ок', [{ tool: 'add_expense', message: 'Записал «обед» 5000 ₸' }])).toBe('Ок');
    expect(withDoneSummary('Ок', [{ tool: 'create_task', message: 'Задача создана' }])).toBe('Ок');
  });
  it('название берётся из «ёлочек» и "кавычек"', () => {
    expect(quotedName('Задача "А б" создана')).toBe('А б');
    expect(quotedName('Завёл привычку «Бег».')).toBe('Бег');
  });
});
