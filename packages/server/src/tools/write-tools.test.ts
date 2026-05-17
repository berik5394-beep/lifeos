import { describe, it, expect } from 'vitest';
import { registry } from './index.js';

/**
 * SSOT Step 5 — контракт write-tools без БД: зарегистрированы,
 * обратимы (needsConfirm:false, никаких денег), sideEffects:write,
 * и zod-схемы принимают РОВНО то, что даёт intent-parser (ловит
 * баги маппинга полей без обращения к Postgres).
 */

const WRITE = [
  'create_task',
  'complete_task',
  'complete_habit',
  'complete_multiple_habits',
  'create_event',
  'journal_entry',
] as const;

describe('write-tools зарегистрированы и обратимы', () => {
  it.each(WRITE)('%s: в реестре, needsConfirm=false, sideEffects=write', (n) => {
    const t = registry.get(n);
    expect(t, `${n} должен быть в реестре`).toBeDefined();
    expect(t!.needsConfirm).toBe(false); // деньги — Шаг 6, не здесь
    expect(t!.sideEffects).toBe('write');
  });
});

describe('zod-схемы принимают форму intent-parser', () => {
  it('create_task: title+date(+time/priority/category)', () => {
    expect(
      registry.get('create_task')!.schema.safeParse({
        title: 'купить хлеб',
        date: '2026-05-20',
        time: '14:00',
        priority: 'medium',
        category: 'personal',
      }).success,
    ).toBe(true);
    expect(
      registry.get('create_task')!.schema.safeParse({ title: 'x' }).success,
    ).toBe(false); // нет date
  });

  it('complete_task: { title } (после маппинга taskTitle→title)', () => {
    expect(
      registry.get('complete_task')!.schema.safeParse({ title: 'отчёт' }).success,
    ).toBe(true);
  });

  it('complete_habit: { name } (после маппинга habitName→name)', () => {
    expect(
      registry.get('complete_habit')!.schema.safeParse({ name: 'бег' }).success,
    ).toBe(true);
  });

  it('complete_multiple_habits: { habitNames: [...] }', () => {
    expect(
      registry
        .get('complete_multiple_habits')!
        .schema.safeParse({ habitNames: ['бег', 'чтение'] }).success,
    ).toBe(true);
  });

  it('create_event: title+date(+startTime/location)', () => {
    expect(
      registry.get('create_event')!.schema.safeParse({
        title: 'встреча с Сериком',
        date: '2026-05-20',
        startTime: '14:00',
        location: 'кафе',
      }).success,
    ).toBe(true);
    expect(
      registry.get('create_event')!.schema.safeParse({
        title: 'x',
        date: '20 мая',
      }).success,
    ).toBe(false); // date не YYYY-MM-DD
  });

  it('journal_entry: частичный апдейт (только mood)', () => {
    expect(
      registry.get('journal_entry')!.schema.safeParse({ mood: 8 }).success,
    ).toBe(true);
    expect(
      registry.get('journal_entry')!.schema.safeParse({ mood: 99 }).success,
    ).toBe(false); // вне 1..10
  });
});
