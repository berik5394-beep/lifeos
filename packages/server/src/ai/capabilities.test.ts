import { describe, it, expect } from 'vitest';
import { LOCAL_TOOLS } from '../services/agent-tools.js';
import {
  DOCUMENTED_TOOLS,
  CAPABILITY_TEXT,
  CONSTRAINTS_TEXT,
} from './capabilities.js';

/**
 * #5 — список умений не должен расходиться с реальным реестром.
 * Этот тест — drift-guard: добавил инструмент в LOCAL_TOOLS, не
 * описав в capabilities → CI падает (а не юзер ловит «бронирую
 * билеты» vs «не покупаю»).
 */
describe('capabilities ↔ tool registry sync', () => {
  it('каждый LOCAL_TOOLS задокументирован', () => {
    const undocumented = LOCAL_TOOLS.map((t) => t.name).filter(
      (n) => !DOCUMENTED_TOOLS.has(n),
    );
    expect(undocumented).toEqual([]);
  });

  it('нет «мёртвых» записей (инструмент убрали — обнови доку)', () => {
    const names = new Set<string>(LOCAL_TOOLS.map((t) => t.name));
    const stale = [...DOCUMENTED_TOOLS].filter((d) => !names.has(d));
    expect(stale).toEqual([]);
  });

  it('CONSTRAINTS честно отрицает покупку/картинки/журнал звонков (#5/#8)', () => {
    expect(CONSTRAINTS_TEXT).toMatch(/НЕ покупаешь|не покупаешь/);
    expect(CONSTRAINTS_TEXT).toMatch(/оплачива/);
    expect(CONSTRAINTS_TEXT).toMatch(/картинк/);
    expect(CONSTRAINTS_TEXT).toMatch(/звонк/);
  });

  it('CAPABILITY покрывает ключевое (поездки, подтверждение денег)', () => {
    expect(CAPABILITY_TEXT).toMatch(/поездк/);
    expect(CAPABILITY_TEXT).toMatch(/подтвержден/);
    expect(CAPABILITY_TEXT.length).toBeGreaterThan(100);
  });
});
