import { describe, it, expect } from 'vitest';
import { driftVerdict, type StrategicFacts } from './strategic-view.js';

const goal = (id: string, progress: number, steps = 0, touched = false) => ({ id, goalText: id === 'm' ? 'Миллион' : 'Книги', progress, steps, touched });

describe('driftVerdict — «взгляд сверху»', () => {
  const busy: StrategicFacts = { weeks: 3, tasksDone: 24, goalSteps: 0, goals: [goal('m', 12), goal('b', 40)] };

  it('3 недели текучки, цель стоит → честная фраза с числами из фактов', () => {
    const v = driftVerdict(busy);
    expect(v?.goal.id).toBe('m'); // из стоящих — с наименьшим прогрессом
    expect(v?.text).toBe(
      'Взгляд сверху: за 3 недели закрыто 24 дела — и ни одно не про цель «Миллион» (она на 12%). ' +
        'Текучка съедает главное. На этой неделе — один шаг к ней? Скажи какой — поставлю в план.',
    );
  });

  it('целей нет — молчим', () => {
    expect(driftVerdict({ ...busy, goals: [] })).toBeNull();
  });

  it('дел мало — не «тушит пожары», молчим', () => {
    expect(driftVerdict({ ...busy, tasksDone: 4 })).toBeNull();
  });

  it('шаги к целям есть (больше 10%) — курс держится', () => {
    expect(driftVerdict({ ...busy, goalSteps: 5 })).toBeNull();
  });

  it('у цели были шаги (привычка) или прогресс трогали — она не «стоит»', () => {
    expect(driftVerdict({ ...busy, goals: [goal('m', 12, 3), goal('b', 40, 0, true)] })).toBeNull();
  });

  it('склонения: 21 дело, 5 дел', () => {
    expect(driftVerdict({ ...busy, tasksDone: 21 })?.text).toMatch(/закрыто 21 дело —/);
    expect(driftVerdict({ ...busy, tasksDone: 7 })?.text).toMatch(/закрыто 7 дел —/);
  });
});
