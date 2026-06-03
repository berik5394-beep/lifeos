import { describe, it, expect } from 'vitest';
import { isOverdue, normalizeDirection, obligationLabel } from './types.js';

describe('obligations/types', () => {
  it('isOverdue: срок в прошлом → true; будущий/нет → false', () => {
    const now = new Date('2026-06-03T12:00:00Z');
    expect(isOverdue(new Date('2026-06-01'), now)).toBe(true);
    expect(isOverdue(new Date('2026-06-10'), now)).toBe(false);
    expect(isOverdue(null, now)).toBe(false);
  });
  it('normalizeDirection: алиасы → канон', () => {
    expect(normalizeDirection('я должен')).toBe('i_owe');
    expect(normalizeDirection('мне должны')).toBe('owed_to_me');
    expect(normalizeDirection('i_owe')).toBe('i_owe');
    expect(normalizeDirection('owed_to_me')).toBe('owed_to_me');
    expect(normalizeDirection('бред')).toBeNull();
  });
  it('obligationLabel: человекочитаемо', () => {
    expect(
      obligationLabel({ direction: 'i_owe', personName: 'Серик', description: 'договор' }),
    ).toBe('Ты должен: Серик — договор');
    expect(
      obligationLabel({ direction: 'owed_to_me', personName: 'Ахмет', description: '500к' }),
    ).toBe('Тебе должен: Ахмет — 500к');
  });
});
