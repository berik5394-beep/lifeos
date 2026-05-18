import { describe, it, expect } from 'vitest';
import { registry } from './index.js';

/**
 * SSOT 9A — миграция agent-only read-tools в единый реестр.
 * Контракт без БД: зарегистрированы, read-only, не требуют confirm,
 * zod-схема принимает форму, которую шлёт claude-agent. Растёт по
 * мере 9A.1→9A.7. Свич claude-agent на реестр — 9A.8.
 */

describe('9A.1 — get_tasks в реестре', () => {
  const t = registry.get('get_tasks');

  it('зарегистрирован, read-only, без confirm', () => {
    expect(t, 'get_tasks в реестре').toBeDefined();
    expect(t!.needsConfirm).toBe(false);
    expect(t!.sideEffects).toBe('read');
    expect(t!.category).toBe('task');
  });

  it('zod принимает форму claude-agent (date?/includeCompleted?)', () => {
    const s = t!.schema;
    expect(s.safeParse({}).success).toBe(true);
    expect(s.safeParse({ date: '2026-05-18' }).success).toBe(true);
    expect(
      s.safeParse({ date: '2026-05-18', includeCompleted: true }).success,
    ).toBe(true);
    expect(s.safeParse({ includeCompleted: 'yes' }).success).toBe(false);
  });
});

describe('9A.2 — get_calendar в реестре', () => {
  const t = registry.get('get_calendar');

  it('зарегистрирован, read-only, без confirm, calendar', () => {
    expect(t, 'get_calendar в реестре').toBeDefined();
    expect(t!.needsConfirm).toBe(false);
    expect(t!.sideEffects).toBe('read');
    expect(t!.category).toBe('calendar');
  });

  it('zod: from/to обязательны (форма claude-agent)', () => {
    const s = t!.schema;
    expect(s.safeParse({ from: '2026-05-18', to: '2026-05-25' }).success).toBe(
      true,
    );
    expect(s.safeParse({ from: '2026-05-18' }).success).toBe(false);
    expect(s.safeParse({}).success).toBe(false);
  });
});
