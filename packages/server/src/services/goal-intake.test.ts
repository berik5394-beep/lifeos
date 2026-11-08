import { describe, it, expect } from 'vitest';
import { buildGoalIntake, type GoalIntakeFacts } from './goal-intake.js';

const NOW = new Date('2026-01-01T09:00:00Z');
// 31.12.2026 — ровно ~12 мес. от NOW.
const DEC = new Date('2026-12-31T23:59:00Z');
const nb = (s: string) => s.replace(/ /g, ' ');

function facts(over: Partial<GoalIntakeFacts>): GoalIntakeFacts {
  return {
    goal: { text: 'Цель', area: 'health', target: null, targetDate: null, year: 2026 },
    money: null,
    time: null,
    slot: null,
    linkableHabit: null,
    moodDown: false,
    now: NOW,
    ...over,
  };
}

const MONEY_GOAL = { text: 'Накопить миллион', area: 'finance', target: 1_200_000, targetDate: DEC, year: 2026 };

describe('разбор денежной цели', () => {
  it('свободных денег хватает → «влезает», цифры из входа', () => {
    const t = nb(buildGoalIntake(facts({ goal: MONEY_GOAL, money: { monthlyIncome: 400_000, monthlyBurn: 200_000, otherGoals: [] } })));
    expect(t).toMatch(/^Это 1\d{2} \d{3} ₸ в месяц до 31\.12; свободно 200 000 ₸ .* — влезает\.$/m);
    expect(t.split('\n')).toHaveLength(2);
    expect(t).toContain('сколько откладывать');
  });

  it('не хватает → сколько именно', () => {
    const t = nb(buildGoalIntake(facts({ goal: MONEY_GOAL, money: { monthlyIncome: 300_000, monthlyBurn: 260_000, otherGoals: [] } })));
    expect(t).toContain('свободно 40 000 ₸');
    expect(t).toMatch(/не хватает [\d ]+ ₸ в месяц\./);
  });

  it('другие денежные цели делят свободные деньги', () => {
    const t = nb(
      buildGoalIntake(
        facts({
          goal: MONEY_GOAL,
          money: {
            monthlyIncome: 400_000,
            monthlyBurn: 200_000,
            otherGoals: [{ text: 'Машина', target: 1_200_000, targetDate: DEC, saved: 0 }],
          },
        }),
      ),
    );
    expect(t).toMatch(/из них [\d ]+ ₸ уже нужны другим целям — не хватает/);
  });

  it('траты ≥ доходов → откладывать не из чего', () => {
    const t = buildGoalIntake(facts({ goal: MONEY_GOAL, money: { monthlyIncome: 100_000, monthlyBurn: 150_000, otherGoals: [] } }));
    expect(t).toContain('откладывать пока не из чего');
  });

  it('доходов не записано → ни одной цифры про деньги', () => {
    const t = buildGoalIntake(facts({ goal: MONEY_GOAL, money: { monthlyIncome: 0, monthlyBurn: 90_000, otherGoals: [] } }));
    const first = t.split('\n')[0];
    expect(first).toContain('Доходов за последние 3 месяца не записано');
    expect(first).not.toMatch(/₸/);
  });

  it('спад настроения → без «не хватает», мягкий вопрос', () => {
    const t = buildGoalIntake(
      facts({ goal: MONEY_GOAL, moodDown: true, money: { monthlyIncome: 300_000, monthlyBurn: 290_000, otherGoals: [] } }),
    );
    expect(t).not.toContain('не хватает');
    expect(t).toContain('когда будешь готов');
  });
});

describe('разбор не-денежной цели', () => {
  const BOOKS = { text: 'Прочитать 24 книги', area: 'personal', target: 24, targetDate: DEC, year: 2026 };

  it('темп + время + привычка + окно в вопросе; максимум 3 строки + вопрос', () => {
    const t = nb(
      buildGoalIntake(
        facts({
          goal: BOOKS,
          time: { goalMinutesPerWeek: 120, weekCapacity: 900, weekDemand: 300 },
          slot: { date: '2026-01-08', from: '18:00', to: '20:00', durationMinutes: 120 },
          linkableHabit: 'Чтение',
        }),
      ),
    );
    const lines = t.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('Это ~2 в месяц до 31.12.');
    expect(lines[1]).toBe('По времени это 2 ч в неделю; до конца этой недели свободно 10 ч — влезает.');
    expect(lines[2]).toBe('Под неё подходит твоя привычка «Чтение» — могу привязать.');
    expect(lines[3]).toBe('Разбить на шаги и поставить первое занятие на четверг (08.01) в 18:00? Скажи «да».');
  });

  it('без числа — без строки темпа; нет окна — простой вопрос; нет привычки — честно', () => {
    const t = buildGoalIntake(
      facts({
        goal: { text: 'Выучить испанский', area: 'education', target: null, targetDate: null, year: 2026 },
        time: { goalMinutesPerWeek: 180, weekCapacity: 200, weekDemand: 100 },
      }),
    );
    const lines = t.split('\n');
    expect(lines[0]).toBe('По времени это 3 ч в неделю; до конца этой недели свободно 1,7 ч — на этой неделе не влезает целиком.');
    expect(lines[1]).toBe('К цели пока не привязана ни одна привычка.');
    expect(lines[2]).toBe('Разбить на шаги? Скажи «да».');
  });

  it('неделя забита → «начнём со следующей»', () => {
    const t = buildGoalIntake(facts({ time: { goalMinutesPerWeek: 60, weekCapacity: 300, weekDemand: 400 } }));
    expect(t).toContain('свободного времени уже нет — начнём со следующей');
  });

  it('оценки времени нет → строки времени нет, не выдумываем', () => {
    const t = buildGoalIntake(facts({ time: null }));
    expect(t).not.toContain('По времени');
  });
});

import { pickLinkableHabit, parseYearlyGoalMinutes } from './goal-intake-gather.js';
describe('привычка по теме цели', () => {
  it('корень привычки внутри слова цели: «Читать» ⊂ «Прочитать», «Бег» → «Бегать»', () => {
    expect(pickLinkableHabit('Прочитать 24 книги', [{ name: 'Зарядка' }, { name: 'Читать 20 минут' }])).toBe('Читать 20 минут');
    expect(pickLinkableHabit('Бегать по утрам', [{ name: 'Бег' }])).toBe('Бег');
  });
  it('нет общего корня → null (случайную привычку не предлагаем)', () => {
    expect(pickLinkableHabit('Выучить испанский', [{ name: 'Зарядка' }, { name: 'Медитация' }])).toBeNull();
  });
});

describe('находки ревью', () => {
  const LATE = new Date('2026-11-08T09:00:00Z');

  it('цель на СЛЕДУЮЩИЙ год без срока → срок 31.12 её года, не текущего', () => {
    const t = nb(
      buildGoalIntake(
        facts({
          now: LATE,
          goal: { text: 'Миллион', area: 'finance', target: 1_000_000, targetDate: null, year: 2027 },
          money: { monthlyIncome: 400_000, monthlyBurn: 200_000, otherGoals: [] },
        }),
      ),
    );
    expect(t).toContain('до 31.12.2027');
    expect(t).toMatch(/^Это [6-7]\d \d{3} ₸ в месяц/); // ~73 тыс., а не ~565 тыс.
  });

  it('срок прошёл или < 2 недель → без «в месяц», предлагаем сдвинуть', () => {
    const past = buildGoalIntake(
      facts({ now: LATE, goal: { ...MONEY_GOAL, targetDate: new Date('2026-03-01T12:00:00Z') }, money: { monthlyIncome: 1, monthlyBurn: 0, otherGoals: [] } }),
    );
    expect(past).toContain('уже прошёл');
    expect(past).not.toContain('в месяц');
    const close = buildGoalIntake(
      facts({ now: LATE, goal: { ...BOOKS_LATE, targetDate: new Date('2026-11-15T12:00:00Z') } }),
    );
    expect(close).toContain('меньше двух недель');
  });

  it('другая цель с прошедшим сроком не раздувает «нужны другим целям»', () => {
    const t = nb(
      buildGoalIntake(
        facts({
          goal: MONEY_GOAL,
          money: {
            monthlyIncome: 400_000,
            monthlyBurn: 200_000,
            otherGoals: [{ text: 'Отпуск', target: 300_000, targetDate: new Date('2025-12-01T00:00:00Z'), saved: 0 }],
          },
        }),
      ),
    );
    expect(t).not.toContain('другим целям');
    expect(t).toContain('влезает');
  });

  it('привычки: «Пить воду» не к «Купить машину», «Медитация 10 минут» не к «Минус 10 кг»', () => {
    expect(pickLinkableHabit('Купить машину', [{ name: 'Пить воду' }])).toBeNull();
    expect(pickLinkableHabit('Минус 10 кг', [{ name: 'Медитация 10 минут' }])).toBeNull();
    expect(pickLinkableHabit('Медитировать каждый день', [{ name: 'Медитация 10 минут' }])).toBe('Медитация 10 минут');
  });

  it('ответ модели без числа → null (не «2 ч»); «5» → 5, без подтяжки до 15', () => {
    expect(parseYearlyGoalMinutes('Сложно оценить')).toBeNull();
    expect(parseYearlyGoalMinutes('5')).toBe(5);
    expect(parseYearlyGoalMinutes('0')).toBe(0);
    expect(parseYearlyGoalMinutes('9999')).toBe(1200);
  });
});
const BOOKS_LATE = { text: 'Прочитать 24 книги', area: 'personal', target: 24, targetDate: null, year: 2026 };

import { buildShortGoalIntake } from './goal-intake.js';
describe('разбор цели недели/месяца', () => {
  const SLOT = { date: '2026-01-08', from: '18:00', to: '20:00', durationMinutes: 120 };
  it('время + привычка (если нашлась) + первое занятие', () => {
    const t = buildShortGoalIntake({
      time: { goalMinutesPerWeek: 90, weekCapacity: 600, weekDemand: 100 },
      slot: SLOT,
      linkableHabit: 'Бег',
      moodDown: false,
    });
    expect(t?.split('\n')).toEqual([
      'По времени это 1,5 ч в неделю; до конца этой недели свободно 8,3 ч — влезает.',
      'Под неё подходит твоя привычка «Бег».',
      'Поставить первое занятие на четверг (08.01) в 18:00? Скажи «да».',
    ]);
  });
  it('нет привычки — строки нет (не шумим); спад — без вопроса', () => {
    const t = buildShortGoalIntake({ time: { goalMinutesPerWeek: 60, weekCapacity: 600, weekDemand: 0 }, slot: SLOT, linkableHabit: null, moodDown: true });
    expect(t).not.toContain('привычк');
    expect(t).not.toContain('Скажи «да»');
  });
  it('нечего сказать → null', () => {
    expect(buildShortGoalIntake({ time: null, slot: null, linkableHabit: null, moodDown: false })).toBeNull();
  });
});
