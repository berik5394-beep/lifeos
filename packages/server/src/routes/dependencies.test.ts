import { describe, it, expect } from 'vitest';
import { wouldCreateCycle } from './dependencies.js';

/** B.2 — детект цикла в зависимостях задач (аудит 2.9). */
describe('wouldCreateCycle', () => {
  it('self-зависимость = цикл', () => {
    expect(wouldCreateCycle([], 'A', 'A')).toBe(true);
  });

  it('A зависит от B, затем B зависит от A → цикл', () => {
    const edges = [{ dependentTaskId: 'A', prerequisiteTaskId: 'B' }];
    expect(wouldCreateCycle(edges, 'B', 'A')).toBe(true);
  });

  it('транзитивный цикл A→B→C, затем C зависит от A', () => {
    const edges = [
      { dependentTaskId: 'A', prerequisiteTaskId: 'B' },
      { dependentTaskId: 'B', prerequisiteTaskId: 'C' },
    ];
    expect(wouldCreateCycle(edges, 'C', 'A')).toBe(true);
  });

  it('валидный DAG — без цикла', () => {
    const edges = [
      { dependentTaskId: 'A', prerequisiteTaskId: 'B' },
      { dependentTaskId: 'A', prerequisiteTaskId: 'C' },
    ];
    expect(wouldCreateCycle(edges, 'B', 'D')).toBe(false);
    expect(wouldCreateCycle(edges, 'C', 'B')).toBe(false);
  });

  it('пустой граф — первое ребро никогда не цикл', () => {
    expect(wouldCreateCycle([], 'X', 'Y')).toBe(false);
  });

  it('не зацикливается на уже существующем цикле в данных', () => {
    // битые данные (A→B, B→A уже есть) — функция должна завершиться
    const edges = [
      { dependentTaskId: 'A', prerequisiteTaskId: 'B' },
      { dependentTaskId: 'B', prerequisiteTaskId: 'A' },
    ];
    expect(wouldCreateCycle(edges, 'C', 'A')).toBe(false);
  });
});
