import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TOOLFIX 2 — структурный тест проводки нормализатора в chokepoint.
 * Гарантирует: вход нормализуется ДО zod (алиасы + относительные даты),
 * исполняется НОРМАЛИЗОВАННЫЙ, а аудит пишет ОРИГИНАЛ rawInput (что реально
 * прислала модель — для разбора «что барахлило»). Ловит регресс, если
 * кто-то вернёт `parse(rawInput)` или уберёт normalizeToolInput.
 */
const SRC = readFileSync(
  join(process.cwd(), 'src/tools/index.ts'),
  'utf-8',
);

describe('runRegistryTool — нормализатор подключён в chokepoint', () => {
  it('импортирует normalizeToolArgs + hasRelativeDate из _normalize-args', () => {
    expect(SRC).toContain(
      "import { normalizeToolArgs, hasRelativeDate } from './_normalize-args.js';",
    );
  });

  it('зовёт normalizeToolInput(tool, rawInput, userId) перед парсом', () => {
    expect(SRC).toContain(
      'const normalizedInput = await normalizeToolInput(tool, rawInput, ctx.userId);',
    );
  });

  it('парсит НОРМАЛИЗОВАННЫЙ вход, а не сырой', () => {
    expect(SRC).toContain('tool.schema.parse(normalizedInput ?? {})');
    expect(SRC).not.toContain('tool.schema.parse(rawInput ?? {})');
  });

  it('нормализация идёт ДО schema.parse (порядок строк)', () => {
    const iNorm = SRC.indexOf('const normalizedInput = await normalizeToolInput');
    const iParse = SRC.indexOf('tool.schema.parse(normalizedInput');
    expect(iNorm).toBeGreaterThan(-1);
    expect(iParse).toBeGreaterThan(iNorm);
  });

  it('аудит пишет ОРИГИНАЛ rawInput (диагностика того, что прислала модель)', () => {
    const iAudit = SRC.indexOf('const result = await auditToolCall(');
    expect(iAudit).toBeGreaterThan(-1);
    // позиционные аргументы auditToolCall: userId, name, rawInput, closure
    const head = SRC.slice(iAudit, iAudit + 200);
    expect(head).toContain('ctx.userId,');
    expect(head).toContain('name,');
    expect(head).toContain('rawInput,');
  });
});

describe('normalizeToolInput — helper с fast-path и TZ-резолвом', () => {
  it('helper определён', () => {
    expect(SRC).toContain('async function normalizeToolInput(');
  });

  it('fast-path: нет алиасов и нет относительных дат → исходный rawInput', () => {
    expect(SRC).toContain('if (!aliases && !needsDate) return rawInput;');
  });

  it('TZ best-effort: getUserTimezone в try, fallback UTC', () => {
    expect(SRC).toContain("let tz = 'UTC';");
    expect(SRC).toContain('tz = await getUserTimezone(userId);');
  });

  it('резолвит относительную дату в TZ юзера через localDateStr', () => {
    expect(SRC).toContain('localDateStr(tz, new Date(Date.now() + offsetDays');
    expect(SRC).toContain('normalizeToolArgs(rawInput, { aliases, resolveDate })');
  });
});
