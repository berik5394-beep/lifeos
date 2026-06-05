import { describe, it, expect } from 'vitest';
import {
  parseBirthday,
  daysUntilBirthday,
  ageOnNextBirthday,
  whenLabel,
  ageSuffix,
  upcomingBirthdays,
  formatBirthdaySection,
  type PersonBirthdayRow,
} from './types.js';

describe('parseBirthday', () => {
  it('структурный объект {day,month,year}', () => {
    expect(parseBirthday({ day: 12, month: 5, year: 1994 })).toEqual({ day: 12, month: 5, year: 1994 });
  });
  it('структурный объект без года', () => {
    expect(parseBirthday({ day: 12, month: 5 })).toEqual({ day: 12, month: 5 });
  });
  it('русская строка «12 мая»', () => {
    expect(parseBirthday('12 мая')).toEqual({ day: 12, month: 5 });
  });
  it('русская строка с годом «12 мая 1994»', () => {
    expect(parseBirthday('12 мая 1994')).toEqual({ day: 12, month: 5, year: 1994 });
  });
  it('русская строка в род. падеже «3 января»', () => {
    expect(parseBirthday('3 января')).toEqual({ day: 3, month: 1 });
  });
  it('числовая «12.05»', () => {
    expect(parseBirthday('12.05')).toEqual({ day: 12, month: 5 });
  });
  it('числовая «12.05.1994»', () => {
    expect(parseBirthday('12.05.1994')).toEqual({ day: 12, month: 5, year: 1994 });
  });
  it('ISO «1994-05-12»', () => {
    expect(parseBirthday('1994-05-12')).toEqual({ day: 12, month: 5, year: 1994 });
  });
  it('29 февраля — валидно', () => {
    expect(parseBirthday('29.02')).toEqual({ day: 29, month: 2 });
  });
  it('31 апреля → null (в апреле 30 дней)', () => {
    expect(parseBirthday('31.04')).toBeNull();
  });
  it('месяц 13 → null', () => {
    expect(parseBirthday('05.13')).toBeNull();
  });
  it('мусор → null', () => {
    expect(parseBirthday('завтра как-нибудь')).toBeNull();
    expect(parseBirthday('')).toBeNull();
    expect(parseBirthday(null)).toBeNull();
    expect(parseBirthday(42)).toBeNull();
  });
  it('год вне 1900-2100 → null', () => {
    expect(parseBirthday('12.05.1850')).toBeNull();
  });
});

describe('daysUntilBirthday (UTC-детерминированно)', () => {
  it('сегодня → 0', () => {
    expect(daysUntilBirthday({ day: 5, month: 6 }, new Date('2026-06-05T00:00:00Z'))).toBe(0);
  });
  it('завтра → 1', () => {
    expect(daysUntilBirthday({ day: 6, month: 6 }, new Date('2026-06-05T00:00:00Z'))).toBe(1);
  });
  it('уже прошёл в этом году → считает на следующий год', () => {
    expect(daysUntilBirthday({ day: 1, month: 6 }, new Date('2026-06-05T00:00:00Z'))).toBe(361);
  });
  it('через границу года: ДР 3 янв при now 30 дек', () => {
    expect(daysUntilBirthday({ day: 3, month: 1 }, new Date('2026-12-30T00:00:00Z'))).toBe(4);
  });
  it('29 фев в невисокосный год → как 1 марта', () => {
    expect(daysUntilBirthday({ day: 29, month: 2 }, new Date('2027-02-27T00:00:00Z'))).toBe(2);
  });
});

describe('ageOnNextBirthday', () => {
  it('без года → null', () => {
    expect(ageOnNextBirthday({ day: 12, month: 5 }, new Date('2026-06-05T00:00:00Z'))).toBeNull();
  });
  it('с годом, ДР ещё впереди в этом году', () => {
    expect(ageOnNextBirthday({ day: 6, month: 6, year: 1994 }, new Date('2026-06-05T00:00:00Z'))).toBe(32);
  });
  it('с годом, ДР в этом году прошёл', () => {
    expect(ageOnNextBirthday({ day: 1, month: 6, year: 1994 }, new Date('2026-06-05T00:00:00Z'))).toBe(33);
  });
});

describe('whenLabel / ageSuffix', () => {
  it('whenLabel', () => {
    expect(whenLabel(0)).toBe('сегодня');
    expect(whenLabel(1)).toBe('завтра');
    expect(whenLabel(3)).toBe('через 3 дн.');
  });
  it('ageSuffix', () => {
    expect(ageSuffix(null)).toBe('');
    expect(ageSuffix(30)).toBe(' (исполнится 30)');
  });
});

describe('upcomingBirthdays', () => {
  const persons: PersonBirthdayRow[] = [
    { entityId: 'e1', name: 'Серик', importance: 7, birthday: { day: 8, month: 6 } },
    { entityId: 'e2', name: 'Ахмет', importance: 9, birthday: { day: 6, month: 6, year: 1996 } },
    { entityId: 'e3', name: 'Далёкий', importance: 5, birthday: { day: 1, month: 12 } },
  ];
  it('фильтрует по окну и сортирует по daysUntil', () => {
    const out = upcomingBirthdays(persons, new Date('2026-06-05T00:00:00Z'), 7);
    expect(out.map((r) => r.name)).toEqual(['Ахмет', 'Серик']);
    expect(out[0]).toEqual({ entityId: 'e2', name: 'Ахмет', importance: 9, daysUntil: 1, age: 30 });
    expect(out[1].age).toBeNull();
  });
  it('пустой результат, если все вне окна', () => {
    expect(upcomingBirthdays(persons, new Date('2026-06-05T00:00:00Z'), 0)).toEqual([]);
  });
});

describe('formatBirthdaySection', () => {
  it('пусто → null', () => {
    expect(formatBirthdaySection([])).toBeNull();
  });
  it('форматирует строку', () => {
    const rows = [
      { entityId: 'e2', name: 'Ахмет', importance: 9, daysUntil: 1, age: 30 },
      { entityId: 'e1', name: 'Серик', importance: 7, daysUntil: 3, age: null },
    ];
    expect(formatBirthdaySection(rows)).toBe('Скоро ДР: Ахмет — завтра; Серик — через 3 дн.');
  });
});
