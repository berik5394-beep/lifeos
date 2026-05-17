import { describe, it, expect } from 'vitest';
import { decDoc } from './documents.js';

/**
 * B.4 — обратная совместимость расшифровки DocumentVault.
 * Старые plaintext-документы (до B.4) должны читаться как есть,
 * битый шифртекст — не валить ответ.
 */
describe('decDoc', () => {
  it('legacy plaintext-объект возвращается как есть', () => {
    const legacy = { passport: '123', name: 'Берик' };
    expect(decDoc(legacy)).toEqual(legacy);
  });
  it('массив/примитив не трактуется как _enc', () => {
    expect(decDoc([1, 2])).toEqual([1, 2]);
    expect(decDoc('plain')).toBe('plain');
    expect(decDoc(null)).toBe(null);
  });
  it('битый шифртекст → {_error}, не throw', () => {
    expect(decDoc({ _enc: 'not-a-valid-cipher' })).toEqual({
      _error: 'decrypt_failed',
    });
  });
});
