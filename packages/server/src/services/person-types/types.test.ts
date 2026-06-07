import { describe, it, expect } from 'vitest';
import { personTypeWeight, pickNeglectedKeyPerson, describeNeglected, type TypedPerson } from './types.js';

describe('personTypeWeight', () => {
  it('бизнес-типы выше личных', () => {
    expect(personTypeWeight('client')).toBe(1.0);
    expect(personTypeWeight('investor')).toBe(0.95);
    expect(personTypeWeight('partner')).toBe(0.9);
    expect(personTypeWeight('family')).toBe(0.7);
    expect(personTypeWeight('friend')).toBe(0.55);
  });
  it('не задан/мусор → 0.6 (нейтрально)', () => {
    expect(personTypeWeight(undefined)).toBe(0.6);
    expect(personTypeWeight('xyz')).toBe(0.6);
  });
});

describe('pickNeglectedKeyPerson', () => {
  const base = (over: Partial<TypedPerson>): TypedPerson => ({ id: 'e1', name: 'X', importance: 5, daysSince: 14, ...over });
  it('типизированный человек выбран, weightedScore + owed в payload', () => {
    const p = base({ id: 'c1', name: 'Ахмет', type: 'client', importance: 6, daysSince: 21 });
    const r = pickNeglectedKeyPerson([p], { c1: 200000 });
    expect(r?.name).toBe('Ахмет');
    expect(r?.type).toBe('client');
    expect(r?.owed).toBe(200000);
    expect(r?.weightedScore).toBeGreaterThan(0);
  });
  it('берёт max weightedScore', () => {
    const friend = base({ id: 'f', name: 'Друг', type: 'friend', importance: 5, daysSince: 14 });
    const client = base({ id: 'c', name: 'Клиент', type: 'client', importance: 8, daysSince: 28 });
    expect(pickNeglectedKeyPerson([friend, client], {})?.name).toBe('Клиент');
  });
  it('не типизирован И importance<7 → не выбираем (не спамим про знакомых)', () => {
    expect(pickNeglectedKeyPerson([base({ type: undefined, importance: 6 })], {})).toBeNull();
  });
  it('не типизирован, но importance≥7 → выбираем', () => {
    expect(pickNeglectedKeyPerson([base({ type: undefined, importance: 7 })], {})).not.toBeNull();
  });
  it('пусто → null', () => {
    expect(pickNeglectedKeyPerson([], {})).toBeNull();
  });
});

describe('describeNeglected', () => {
  it('с owed — деньги в тексте', () => {
    const s = describeNeglected({ name: 'Ахмет', type: 'client', daysSince: 21, weightedScore: 1, owed: 200000 });
    expect(s).toContain('Ахмет');
    expect(s).toContain('200000');
  });
  it('без owed — без денег', () => {
    const s = describeNeglected({ name: 'Серик', type: 'partner', daysSince: 15, weightedScore: 1 });
    expect(s).toContain('Серик');
    expect(s).not.toContain('должен');
  });
});
