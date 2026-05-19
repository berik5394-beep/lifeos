import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 5 P1 — schema-инвариант (без БД, как registry-consistency/
 * money-safety: парсим исходник, гарантируем форму). Юнит-тесты
 * репо чистые (нет тестовой Postgres), поэтому CASCADE/индексы
 * проверяем по schema.prisma + migration.sql детерминированно —
 * регресс ловится в CI, а не в проде.
 */

const root = process.cwd(); // packages/server при vitest
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf-8');

function modelBlock(name: string): string {
  const m = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`model ${name} не найден`);
  return m[0];
}

const PLAN_ENTITIES = ['YearlyGoal', 'WeeklyGoal', 'Task', 'Habit'];

describe('Phase 5 P1 — planner-дерево на 4 сущностях', () => {
  it.each(PLAN_ENTITIES)(
    '%s: planParentId/planParentType/derivedFrom + index',
    (name) => {
      const b = modelBlock(name);
      expect(b, `${name}.planParentId`).toMatch(/planParentId\s+String\?/);
      expect(b, `${name}.planParentType`).toMatch(
        /planParentType\s+String\?/,
      );
      expect(b, `${name}.derivedFrom`).toMatch(
        /derivedFrom\s+String\s+@default\("user"\)/,
      );
      expect(b, `${name} @@index(planParentId)`).toMatch(
        /@@index\(\[planParentId\]\)/,
      );
    },
  );

  it('Task.parentId (сабтаски, self-FK) НЕ тронут — поведение P1 не меняет', () => {
    const b = modelBlock('Task');
    expect(b).toMatch(
      /parent\s+Task\?\s+@relation\("TaskSubtasks", fields: \[parentId\], references: \[id\]\)/,
    );
  });
});

describe('Phase 5 P2 — YearlyGoal pacing (E + custom)', () => {
  const b = modelBlock('YearlyGoal');
  it('target/pacingMode(default uniform)/pacingPlan присутствуют', () => {
    expect(b).toMatch(/target\s+Float\?/);
    expect(b).toMatch(/pacingMode\s+String\s+@default\("uniform"\)/);
    expect(b).toMatch(/pacingPlan\s+Json\?/);
  });
  it('миграция p2_yearlygoal_pacing аддитивно добавляет поля', () => {
    const dir = join(root, 'prisma/migrations');
    const mig = readdirSync(dir).find((d) =>
      d.includes('p2_yearlygoal_pacing'),
    );
    expect(mig).toBeTruthy();
    const sql = readFileSync(join(dir, mig!, 'migration.sql'), 'utf-8');
    expect(sql).toMatch(
      /ALTER TABLE "YearlyGoal" ADD COLUMN IF NOT EXISTS "target"/,
    );
    expect(sql).toMatch(/"pacingMode" TEXT NOT NULL DEFAULT 'uniform'/);
    expect(sql).toMatch(
      /ALTER TABLE "YearlyGoal" ADD COLUMN IF NOT EXISTS "pacingPlan"/,
    );
    // ISSUE-X инвариант: миграция НЕ деструктивна (db push-safe).
    expect(sql).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
  });
});

describe('Phase 5 P2 4/5 — re-decompose foundation (W2/ISSUE-Z)', () => {
  it('WeeklyGoal: createdAt + archivedAt', () => {
    const b = modelBlock('WeeklyGoal');
    expect(b).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(b).toMatch(/archivedAt\s+DateTime\?/);
  });
  it('Habit: archivedAt (createdAt уже был)', () => {
    expect(modelBlock('Habit')).toMatch(/archivedAt\s+DateTime\?/);
  });
  it('YearlyGoal: updatedAt @updatedAt (для истинного planStale)', () => {
    expect(modelBlock('YearlyGoal')).toMatch(
      /updatedAt\s+DateTime\s+@updatedAt\s+@default\(now\(\)\)/,
    );
  });
  it('миграция p2_45_archived_at — аддитивна, без DROP', () => {
    const dir = join(root, 'prisma/migrations');
    const mig = readdirSync(dir).find((d) =>
      d.includes('p2_45_archived_at'),
    );
    expect(mig).toBeTruthy();
    const sql = readFileSync(join(dir, mig!, 'migration.sql'), 'utf-8');
    expect(sql).toMatch(
      /ALTER TABLE "WeeklyGoal" ADD COLUMN IF NOT EXISTS "createdAt"/,
    );
    expect(sql).toMatch(
      /ALTER TABLE "WeeklyGoal" ADD COLUMN IF NOT EXISTS "archivedAt"/,
    );
    expect(sql).toMatch(
      /ALTER TABLE "Habit" ADD COLUMN IF NOT EXISTS "archivedAt"/,
    );
    expect(sql).toMatch(
      /ALTER TABLE "YearlyGoal" ADD COLUMN IF NOT EXISTS "updatedAt"/,
    );
    expect(sql).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
  });
});

describe('Phase 5 P1 — Insight (рефлектор)', () => {
  const ins = modelBlock('Insight');
  it('обязательные поля присутствуют', () => {
    for (const f of [
      /severity\s+Int/,
      /scope\s+Json/,
      /message\s+String/,
      /rationale\s+String\?/,
      /suggestedAction\s+Json\?/,
      /deliveredAt\s+DateTime\?/,
      /userFeedback\s+String\?/,
      /dismissed\s+Boolean\s+@default\(false\)/,
    ]) {
      expect(ins).toMatch(f);
    }
  });

  it('userId FK с onDelete:Cascade (инсайты уходят с юзером, не аудит)', () => {
    expect(ins).toMatch(
      /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/,
    );
  });

  it('feed + delivery индексы', () => {
    expect(ins).toMatch(/@@index\(\[userId, createdAt\]\)/);
    expect(ins).toMatch(/@@index\(\[userId, deliveredAt, severity\]\)/);
  });

  it('User.insights обратная связь объявлена', () => {
    expect(modelBlock('User')).toMatch(/insights\s+Insight\[\]/);
  });
});

describe('Phase 5 P1 — миграция реально создаёт структуру', () => {
  const dir = join(root, 'prisma/migrations');
  const mig = readdirSync(dir).find((d) =>
    d.includes('phase5_hierarchy_insight'),
  );
  it('файл миграции существует', () => {
    expect(mig, 'миграция phase5_hierarchy_insight').toBeTruthy();
  });
  const sql = readFileSync(join(dir, mig!, 'migration.sql'), 'utf-8');

  it.each(PLAN_ENTITIES)('%s: ADD COLUMN + index в SQL', (name) => {
    expect(sql).toMatch(
      new RegExp(`ALTER TABLE "${name}" ADD COLUMN IF NOT EXISTS "planParentId"`),
    );
    expect(sql).toMatch(
      new RegExp(`"${name}_planParentId_idx" ON "${name}"`),
    );
  });

  it('Insight: таблица, оба индекса, FK CASCADE', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "Insight"/);
    expect(sql).toMatch(/"Insight_userId_createdAt_idx"/);
    expect(sql).toMatch(/"Insight_userId_deliveredAt_severity_idx"/);
    expect(sql).toMatch(/Insight_userId_fkey[\s\S]*ON DELETE CASCADE/);
  });
});
