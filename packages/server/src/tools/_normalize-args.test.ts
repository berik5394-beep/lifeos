import { describe, it, expect } from 'vitest';
import { normalizeToolArgs, hasRelativeDate } from './_normalize-args.js';

// Стаб резолвера: off=0→today, 1→tomorrow, 2→day-after, -1→yesterday.
const resolveDate = (off: number) =>
  ({ '-1': '2026-06-01', '0': '2026-06-02', '1': '2026-06-03', '2': '2026-06-04' } as Record<
    string,
    string
  >)[String(off)] ?? '2026-06-02';

describe('normalizeToolArgs — алиасы имён полей', () => {
  it('due_date → date (реальный упавший create_task)', () => {
    const r = normalizeToolArgs(
      { title: 'Выкатить', due_date: '2026-06-08', description: 'X' },
      { aliases: { due_date: 'date', description: 'notes' } },
    ) as Record<string, unknown>;
    expect(r.date).toBe('2026-06-08');
    expect(r.notes).toBe('X');
    expect('due_date' in r).toBe(false);
    expect('description' in r).toBe(false);
    expect(r.title).toBe('Выкатить');
  });

  it('НЕ перезаписывает уже существующее каноническое поле', () => {
    const r = normalizeToolArgs(
      { date: '2026-01-01', due_date: '2026-09-09' },
      { aliases: { due_date: 'date' } },
    ) as Record<string, unknown>;
    expect(r.date).toBe('2026-01-01');
    expect('due_date' in r).toBe(false);
  });

  it('alias с undefined-значением игнорируется', () => {
    const r = normalizeToolArgs(
      { due_date: undefined, title: 't' },
      { aliases: { due_date: 'date' } },
    ) as Record<string, unknown>;
    expect('date' in r).toBe(false);
    expect(r.title).toBe('t');
  });
});

describe('normalizeToolArgs — относительные даты → ISO', () => {
  it('"today" → ISO (реальный упавший get_tasks)', () => {
    const r = normalizeToolArgs({ date: 'today' }, { resolveDate }) as Record<string, unknown>;
    expect(r.date).toBe('2026-06-02');
  });

  it('"завтра"/"послезавтра"/"вчера" (RU) → ISO', () => {
    expect((normalizeToolArgs({ d: 'завтра' }, { resolveDate }) as any).d).toBe('2026-06-03');
    expect((normalizeToolArgs({ d: 'послезавтра' }, { resolveDate }) as any).d).toBe('2026-06-04');
    expect((normalizeToolArgs({ d: 'вчера' }, { resolveDate }) as any).d).toBe('2026-06-01');
  });

  it('регистр/пробелы не мешают ("Сегодня ", "TOMORROW")', () => {
    expect((normalizeToolArgs({ d: 'Сегодня ' }, { resolveDate }) as any).d).toBe('2026-06-02');
    expect((normalizeToolArgs({ d: 'TOMORROW' }, { resolveDate }) as any).d).toBe('2026-06-03');
  });

  it('НЕ трогает уже-ISO даты и не-датовые строки/числа (деньги цел)', () => {
    const r = normalizeToolArgs(
      { date: '2026-07-08', category: 'food', amount: 5000, note: 'я сегодня поел' },
      { resolveDate },
    ) as Record<string, unknown>;
    expect(r.date).toBe('2026-07-08'); // ISO не трогаем
    expect(r.category).toBe('food');
    expect(r.amount).toBe(5000); // число не трогаем
    expect(r.note).toBe('я сегодня поел'); // фраза (не ровно слово) не трогаем
  });
});

describe('normalizeToolArgs — defensive', () => {
  it('не-объект / null / массив → возвращается как есть, не бросает', () => {
    expect(normalizeToolArgs(null, {})).toBeNull();
    expect(normalizeToolArgs(42, {})).toBe(42);
    expect(normalizeToolArgs('x', {})).toBe('x');
    expect(Array.isArray(normalizeToolArgs([1, 2], {}))).toBe(true);
  });
  it('пустые opts → объект не меняется', () => {
    const r = normalizeToolArgs({ a: 1, b: 'today' }, {}) as Record<string, unknown>;
    expect(r.a).toBe(1);
    expect(r.b).toBe('today'); // без resolveDate относительные не трогаем
  });
});

describe('hasRelativeDate — дешёвая проверка для chokepoint', () => {
  it('true если есть ровно относительное слово', () => {
    expect(hasRelativeDate({ date: 'today' })).toBe(true);
    expect(hasRelativeDate({ d: 'завтра', x: 1 })).toBe(true);
  });
  it('false для ISO/фраз/чисел/не-объектов', () => {
    expect(hasRelativeDate({ date: '2026-07-08', amount: 5000 })).toBe(false);
    expect(hasRelativeDate({ note: 'я сегодня поел' })).toBe(false);
    expect(hasRelativeDate(null)).toBe(false);
    expect(hasRelativeDate(42)).toBe(false);
  });
});
