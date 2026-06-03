import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('GET /subscription — роут статуса подписки (4.4)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/routes/subscription.ts'), 'utf-8');
  const IDX = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf-8');
  it('роут под auth, читает subscriptionTier + expiresAt из User', () => {
    expect(SRC).toContain("app.get('/subscription'");
    expect(SRC).toContain('authMiddleware');
    expect(SRC).toContain('subscriptionTier');
    expect(SRC).toContain('subscriptionExpiresAt');
  });
  it("tier нормализуется к 'free'|'pro' (free по умолчанию)", () => {
    expect(SRC).toMatch(/=== 'pro' \? 'pro' : 'free'/);
  });
  it('зарегистрирован в index.ts', () => {
    expect(IDX).toContain('subscriptionRoutes');
    expect(IDX).toContain('await app.register(subscriptionRoutes)');
  });
});
