import { describe, it, expect } from 'vitest';
import {
  registry,
  confirmAlwaysNames,
  agentToolNames,
  toolConfirmRequired,
} from './index.js';

/**
 * Phase 6 C2.4 — get_user_profile инварианты (money-safety-style):
 * read-only, needsConfirm:false → разрешён автономному агент-циклу,
 * НЕ требует подтверждения, НЕ в confirmAlways. Ничего не меняет.
 */

describe('get_user_profile — registry-инварианты', () => {
  it('в реестре, info/read, needsConfirm=false', () => {
    const t = registry.get('get_user_profile');
    expect(t, 'в реестре').toBeDefined();
    expect(t!.category).toBe('info');
    expect(t!.sideEffects).toBe('read');
    expect(t!.needsConfirm).toBe(false);
  });

  it('НЕ требует confirm; разрешён агент-циклу; не в confirmAlways', () => {
    expect(toolConfirmRequired('get_user_profile', {})).toBe(false);
    expect(agentToolNames().has('get_user_profile')).toBe(true);
    expect(confirmAlwaysNames()).not.toContain('get_user_profile');
  });

  it('schema принимает пустой вход', () => {
    expect(
      registry.get('get_user_profile')!.schema.safeParse({}).success,
    ).toBe(true);
  });
});
