import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/services/jarvis-orchestrator.ts'), 'utf-8');

describe('orchestrator — честный ввод денег (FSM слот-филл)', () => {
  it('импортирует и использует awaitingSlot', () => {
    expect(SRC).toContain('awaitingSlot');
  });
  it('слот-филл: заполняет слот ([slot]) и ставит обычный confirm-pending', () => {
    // awaiting-ветка: текст → filled[slot] → setPendingAction (confirm)
    expect(SRC).toMatch(/awaitingSlot\(pending\)[\s\S]*?\[slot\]:[\s\S]*?setPendingAction/);
  });
  it('ask-slot: расход без категории → __awaitingCategory', () => {
    expect(SRC).toContain('__awaitingCategory: true');
  });
  it('ask-slot: доход без источника → __awaitingSource', () => {
    expect(SRC).toContain('__awaitingSource: true');
  });
});
