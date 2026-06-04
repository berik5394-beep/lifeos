import { describe, it, expect } from 'vitest';
import {
  pickRelationshipLink,
  describeRelationshipLink,
  type StalePerson,
  type OpenObligation,
} from './types.js';

const serik: StalePerson = { id: 'e1', name: 'Серик', daysSince: 16, importance: 7 };
const ahmet: StalePerson = { id: 'e2', name: 'Ахмет', daysSince: 20, importance: 6 };

describe('relationship-link/types', () => {
  it('pickRelationshipLink: первый человек с обязательством', () => {
    const obls: Record<string, OpenObligation[]> = {
      e2: [{ direction: 'i_owe', description: 'отчёт' }],
    };
    const link = pickRelationshipLink([serik, ahmet], obls);
    expect(link).toEqual({
      personName: 'Ахмет',
      daysSince: 20,
      direction: 'i_owe',
      description: 'отчёт',
    });
  });

  it('pickRelationshipLink: предпочитает раннего в списке (importance desc)', () => {
    const obls: Record<string, OpenObligation[]> = {
      e1: [{ direction: 'owed_to_me', description: 'деньги' }],
      e2: [{ direction: 'i_owe', description: 'отчёт' }],
    };
    const link = pickRelationshipLink([serik, ahmet], obls);
    expect(link?.personName).toBe('Серик');
  });

  it('pickRelationshipLink: никто без обязательства → null', () => {
    expect(pickRelationshipLink([serik, ahmet], {})).toBeNull();
  });

  it('describeRelationshipLink: i_owe', () => {
    const s = describeRelationshipLink({
      personName: 'Серик', daysSince: 16, direction: 'i_owe', description: 'отчёт',
    });
    expect(s).toContain('Серик');
    expect(s).toContain('16');
    expect(s).toContain('ты ему должен');
    expect(s).toContain('отчёт');
  });

  it('describeRelationshipLink: owed_to_me', () => {
    const s = describeRelationshipLink({
      personName: 'Ахмет', daysSince: 20, direction: 'owed_to_me', description: 'деньги',
    });
    expect(s).toContain('он тебе должен');
    expect(s).toContain('деньги');
  });
});
