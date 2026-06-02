import { describe, it, expect } from 'vitest';
import { decideGoalWrite } from './goal-write.js';

describe('decideGoalWrite — create vs update', () => {
  it('goalId совпал с кандидатом → update', () => {
    const r = decideGoalWrite(
      [{ id: 'g1', goalText: 'старая' }],
      { goalId: 'g1', goalText: 'неважно' },
    );
    expect(r).toEqual({ mode: 'update', goalId: 'g1' });
  });

  it('точное совпадение текста (другой регистр) → update', () => {
    const r = decideGoalWrite(
      [{ id: 'g2', goalText: 'Накопить 100к' }],
      { goalText: 'накопить 100к' },
    );
    expect(r).toEqual({ mode: 'update', goalId: 'g2' });
  });

  it('дописал хвост к той же цели (префикс) → update её', () => {
    const r = decideGoalWrite(
      [{ id: 'g3', goalText: 'накопить 100к' }],
      { goalText: 'накопить 100к к августу' },
    );
    expect(r).toEqual({ mode: 'update', goalId: 'g3' });
  });

  it('разные фин-цели (100к к месяцу vs 3 млн за год) → create (две цели)', () => {
    const r = decideGoalWrite(
      [{ id: 'g4', goalText: 'накопить 3 млн за год' }],
      { goalText: 'накопить 100к к концу месяца' },
    );
    expect(r).toEqual({ mode: 'create' });
  });

  it('нет существующих → create', () => {
    expect(decideGoalWrite([], { goalText: 'накопить 100к' })).toEqual({
      mode: 'create',
    });
  });

  it('goalId не найден среди кандидатов + текст не совпал → create', () => {
    const r = decideGoalWrite(
      [{ id: 'g5', goalText: 'совсем другое' }],
      { goalId: 'missing', goalText: 'новая цель' },
    );
    expect(r).toEqual({ mode: 'create' });
  });

  it('короткий общий префикс (<8) не склеивает разные цели', () => {
    const r = decideGoalWrite(
      [{ id: 'g6', goalText: 'бег' }],
      { goalText: 'бегать марафон' },
    );
    expect(r).toEqual({ mode: 'create' });
  });
});
