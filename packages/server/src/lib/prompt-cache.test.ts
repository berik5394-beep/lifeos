import { describe, it, expect } from 'vitest';
import { cachedSystem, withCachedTools } from './prompt-cache.js';

describe('кэш промптов', () => {
  it('system — блок текста с меткой ephemeral (текст не меняется)', () => {
    expect(cachedSystem('Ты — LifeOS')).toEqual([{ type: 'text', text: 'Ты — LifeOS', cache_control: { type: 'ephemeral' } }]);
  });
  it('метка только на последней схеме инструментов; исходный список не мутируется', () => {
    const tools = [{ name: 'a' }, { name: 'b' }];
    const out = withCachedTools(tools)!;
    expect(out[0]).toEqual({ name: 'a' });
    expect(out[1]).toEqual({ name: 'b', cache_control: { type: 'ephemeral' } });
    expect(tools[1]).toEqual({ name: 'b' });
    expect(withCachedTools(undefined)).toBeUndefined();
    expect(withCachedTools([])).toEqual([]);
  });
});
