import { describe, it, expect } from 'vitest';
import { botDisplayName, DEFAULT_BOT_NAME } from './bot-name.js';

describe('имя робота — одно везде', () => {
  it('старые умолчания и пусто → ЛайфОС; своё имя — уважаем', () => {
    for (const n of [null, undefined, '', 'Эля', 'JARVIS', 'Jarvis', '  эля ']) expect(botDisplayName(n)).toBe(DEFAULT_BOT_NAME);
    expect(botDisplayName('Буся')).toBe('Буся');
  });
});
