import { describe, it, expect } from 'vitest';
import { cachedSystem, systemText, withCachedTools } from './prompt-cache.js';
import { SYSTEM_CACHE_BREAK } from '../ai/jarvis-prompt.js';

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

describe('cachedSystem — неизменное начало в кэш, хвост хода отдельно (2026-11-10)', () => {
  it('с границей: два блока, метка только на первом, граница не попадает в текст', () => {
    const blocks = cachedSystem(`ПРАВИЛА${SYSTEM_CACHE_BREAK}СЕЙЧАС: 14:37\n\nКОНТЕКСТ`);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'text', text: 'ПРАВИЛА', cache_control: { type: 'ephemeral' } });
    expect(blocks[1]).toEqual({ type: 'text', text: 'СЕЙЧАС: 14:37\n\nКОНТЕКСТ' });
    expect(JSON.stringify(blocks)).not.toContain('cache-break');
  });
  it('systemText убирает границу для путей без cachedSystem', () => {
    expect(systemText(`А${SYSTEM_CACHE_BREAK}Б`)).toBe('А\n\nБ');
  });
});
