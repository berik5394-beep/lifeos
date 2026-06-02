import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registry } from './index.js';

const SRC = readFileSync(join(__dirname, 'index.ts'), 'utf8');

describe('v2 tools wired into registry', () => {
  it('registry exposes all 3 v2 tools', () => {
    expect(registry.has('remember_entity')).toBe(true);
    expect(registry.has('link_relationship')).toBe(true);
    expect(registry.has('suggest_goal')).toBe(true);
  });
  it('index.ts imports all 3', () => {
    expect(SRC).toMatch(/from '\.\/remember-entity\.js'/);
    expect(SRC).toMatch(/from '\.\/link-relationship\.js'/);
    expect(SRC).toMatch(/from '\.\/suggest-goal\.js'/);
  });
  it('ALL_TOOLS array lists all 3 by reference', () => {
    expect(SRC).toMatch(/\brememberEntityTool\b/);
    expect(SRC).toMatch(/\blinkRelationshipTool\b/);
    expect(SRC).toMatch(/\bsuggestGoalTool\b/);
  });
  it('suggest_goal — агент-вызываемый предложитель, запись confirm-gated', () => {
    const t = registry.get('suggest_goal')!;
    // needsConfirm:false → агент ВИДИТ и вызывает (раньше needsConfirm:true
    // исключал его из набора → недостижим → цель не предлагалась, SMOKE).
    // Инвариант сохранён иначе: сам инструмент НЕ пишет — ставит pending
    // commit_goal + вопрос; реальная запись на «да» (confirm-gated).
    expect(t.needsConfirm).toBe(false);
    const toolSrc = readFileSync(join(__dirname, 'suggest-goal.ts'), 'utf8');
    expect(toolSrc).toContain("'commit_goal'");
    expect(toolSrc).not.toMatch(/prisma\.yearlyGoal\.(create|update)/);
  });
});
