import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 6 C1 crisis-isolation — структурные инварианты (source-parse,
 * как safety-overrides-toxic: refactor-proof, без БД).
 *  (d) LLM-контекст НЕ содержит crisis-ходы (getRecentHistory).
 *  (b) scheduler чистит crisis>30д (retention).
 * Если кто-то уберёт фильтр/purge — тест станет красным.
 */

const ORCH = readFileSync(
  join(process.cwd(), 'src/services/jarvis-orchestrator.ts'),
  'utf-8',
);
const SCHED = readFileSync(
  join(process.cwd(), 'src/services/proactive-scheduler.ts'),
  'utf-8',
);

describe('crisis-isolation (d) — LLM-контекст исключает crisis', () => {
  it('getRecentHistory where фильтрует crisis:false', () => {
    const fn = ORCH.slice(
      ORCH.indexOf('async function getRecentHistory'),
      ORCH.indexOf('async function getRecentHistory') + 600,
    );
    expect(fn).toContain('chatMessage.findMany');
    expect(fn).toMatch(/where:\s*\{\s*userId,\s*crisis:\s*false\s*\}/);
  });
});

describe('crisis-isolation (b) — retention 30д в scheduler', () => {
  it('deleteMany crisis=true старше 30 дней присутствует', () => {
    expect(SCHED).toMatch(/chatMessage\.deleteMany/);
    expect(SCHED).toMatch(/crisis:\s*true/);
    expect(SCHED).toMatch(/30\s*\*\s*86_400_000/);
    expect(SCHED).toMatch(/createdAt:\s*\{\s*lt:\s*cutoff\s*\}/);
  });
});
