import { describe, it, expect } from 'vitest';
import { withTimeout } from './with-timeout.js';

const after = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const rejectAfter = (ms: number) =>
  new Promise<number>((_, rej) => setTimeout(() => rej(new Error('boom')), ms));

describe('withTimeout', () => {
  it('успел до таймаута → возвращает значение', async () => {
    expect(await withTimeout(after(5, 42), 50, -1)).toBe(42);
  });
  it('не успел → возвращает fallback', async () => {
    expect(await withTimeout(after(60, 42), 15, -1)).toBe(-1);
  });
  it('исходный промис упал → fallback (не бросает)', async () => {
    await expect(withTimeout(rejectAfter(5), 50, 999)).resolves.toBe(999);
  });
  it('fallback может быть null', async () => {
    expect(await withTimeout(after(60, 'x'), 10, null)).toBeNull();
  });
});
