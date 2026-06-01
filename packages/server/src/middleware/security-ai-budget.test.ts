import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'security.ts'), 'utf8');

// 2.3 (AUDIT-2026-06): дневной AI-бюджет должен быть durable (Postgres),
// а не in-memory — иначе единственный гард стоимости Claude теряется при
// рестарте. Поведенчески (БД) не тестируем — проверяем структурно.
describe('aiDailyLimiter — durable AI budget', () => {
  const body = SRC.slice(SRC.indexOf('export const aiDailyLimiter'));

  it('атомарный upsert-increment в prisma.aiUsageDaily (не in-memory bucket)', () => {
    expect(body).toMatch(/prisma\.aiUsageDaily\.upsert/);
    expect(body).toMatch(/count:\s*\{\s*increment:\s*1\s*\}/);
    // больше НЕ обёртка над in-memory rateLimiter
    expect(body).not.toMatch(/rateLimiter\(\{/);
  });
  it('ключ по (userId, день) — одна строка на юзера в сутки', () => {
    expect(body).toMatch(/userId_day/);
    expect(body).toMatch(/Date\.UTC/);
  });
  it('429 при превышении и fail-open при сбое БД', () => {
    expect(body).toMatch(/status\(429\)/);
    expect(body).toMatch(/failing open/);
  });
});
