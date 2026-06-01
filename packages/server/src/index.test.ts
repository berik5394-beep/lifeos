import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'index.ts'), 'utf8');

// 1.5 (AUDIT-2026-06): process-level backstop. Раньше unhandled rejection /
// uncaught exception нигде не логировались (в Node ≥15 rejection по умолчанию
// молча роняет процесс). Структурно проверяем, что хендлеры зарегистрированы.
describe('index — 1.5 process-level backstop', () => {
  it('регистрирует unhandledRejection и uncaughtException хендлеры', () => {
    expect(SRC).toMatch(/process\.on\('unhandledRejection'/);
    expect(SRC).toMatch(/process\.on\('uncaughtException'/);
  });
  it('оба хендлера логируют через app.log.error', () => {
    const u = SRC.indexOf("process.on('unhandledRejection'");
    expect(SRC.slice(u)).toMatch(/app\.log\.error/);
  });
  it('uncaughtException делает graceful shutdown', () => {
    const idx = SRC.indexOf("process.on('uncaughtException'");
    expect(idx).toBeGreaterThan(-1);
    expect(SRC.slice(idx)).toMatch(/shutdown\('uncaughtException'\)/);
  });
  it('2.4: оба backstop-хендлера шлют alertError в Telegram', () => {
    const u = SRC.indexOf("process.on('unhandledRejection'");
    const e = SRC.indexOf("process.on('uncaughtException'");
    expect(SRC.slice(u, u + 220)).toMatch(/alertError\('unhandledRejection'/);
    expect(SRC.slice(e, e + 220)).toMatch(/alertError\('uncaughtException'/);
  });
});
