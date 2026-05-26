import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 7 — tool-filter by integration availability (Relayna pattern).
 * Structural invariant (без БД, как phase5/6/7-schema): парсим
 * исходники. Закрывает класс hollow-tools — tool не показывается
 * агенту если у юзера соответствующая integration не активна.
 *
 * Refactor-proof: если кто-то удалит requires из get-email-triage
 * или уберёт async filter из реестра — тест красный.
 */

const root = process.cwd();

describe('Phase 7 — tool-filter: types contract', () => {
  const types = readFileSync(join(root, 'src/tools/_types.ts'), 'utf-8');

  it('IntegrationRequirement тип экспортирован', () => {
    expect(types).toMatch(/export type IntegrationRequirement\s*=/);
  });

  it('IntegrationRequirement содержит google_oauth и telegram_user_chat', () => {
    expect(types).toMatch(/kind:\s*'google_oauth'/);
    expect(types).toMatch(/kind:\s*'telegram_user_chat'/);
  });

  it('Tool interface содержит requires?: IntegrationRequirement', () => {
    expect(types).toMatch(/requires\?\s*:\s*IntegrationRequirement/);
  });

  it('defineTool хелпер тоже принимает requires', () => {
    // Должен быть в обоих местах: type Tool и defineTool generic.
    const occurrences = types.match(/requires\?\s*:\s*IntegrationRequirement/g);
    expect(occurrences?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Phase 7 — tool-filter: реестр exports user-aware функции', () => {
  const idx = readFileSync(join(root, 'src/tools/index.ts'), 'utf-8');

  it('agentToolSchemasForUser экспортирован как async', () => {
    expect(idx).toMatch(
      /export async function agentToolSchemasForUser\(\s*userId:\s*string,?\s*\)/,
    );
  });

  it('agentToolNamesForUser экспортирован как async', () => {
    expect(idx).toMatch(
      /export async function agentToolNamesForUser\(\s*userId:\s*string,?\s*\)/,
    );
  });

  it('integrationAvailable helper присутствует (filter logic)', () => {
    expect(idx).toMatch(/function integrationAvailable/);
  });

  it('фильтр читает реальные integrations из prisma (не mock)', () => {
    expect(idx).toMatch(/prisma\.integration\.findMany/);
  });

  it('google_oauth требует refreshToken (не просто active)', () => {
    expect(idx).toMatch(/refreshToken\s*!==\s*null/);
  });
});

describe('Phase 7 — tool-filter: get-email-triage помечен', () => {
  const tool = readFileSync(
    join(root, 'src/tools/get-email-triage.ts'),
    'utf-8',
  );

  it("requires: { kind: 'google_oauth' }", () => {
    expect(tool).toMatch(/requires:\s*\{\s*kind:\s*'google_oauth'\s*\}/);
  });

  it('graceful fallback в handler остаётся (defense-in-depth)', () => {
    expect(tool).toMatch(/try\s*\{/);
    expect(tool).toMatch(/catch\s*\(/);
    expect(tool).toMatch(/GoogleCalendarError/);
  });
});

describe('Phase 7 — tool-filter: claude-agent.ts использует user-aware версии', () => {
  const ca = readFileSync(
    join(root, 'src/services/claude-agent.ts'),
    'utf-8',
  );

  it('импорт agentToolSchemasForUser (не старая agentToolSchemas)', () => {
    expect(ca).toMatch(/agentToolSchemasForUser/);
  });

  it('импорт agentToolNamesForUser', () => {
    expect(ca).toMatch(/agentToolNamesForUser/);
  });

  it('агент-цикл вызывает await на user-aware filter', () => {
    expect(ca).toMatch(/await agentToolSchemasForUser\(\s*userId\s*\)/);
  });
});
