import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Structural lint — regression guard для C2 (AUDIT-2026-06).
 *
 * Bug: 25 production callsites делали `new Anthropic({ apiKey })` без
 * timeout → SDK default 600с → запрос висел до ~10 мин при латенси Claude,
 * забивая пул соединений. Теперь единственный легитимный конструктор —
 * `createAnthropic()` в `lib/anthropic.ts` (timeout + maxRetries).
 *
 * Этот тест ищет ЛЮБОЙ `new Anthropic(` в production .ts вне фабрики →
 * если кто-то скопипастит SDK-сниппет без таймаута, CI красный ДО прод.
 *
 * Разрешения:
 *  - lib/anthropic.ts — единственный legitimate конструктор
 *  - этот тест-файл (содержит forbidden строку как pattern)
 *  - test файлы (реальный прод-вызов не делают)
 */

const ROOT = join(process.cwd(), 'src');
const FORBIDDEN = /new\s+Anthropic\s*\(/g;

const ALLOWED_FILES = new Set([
  'lib/anthropic.ts',
  'lib/anthropic-discipline.test.ts',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (s.isFile() && ['.ts', '.tsx'].includes(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

describe('anthropic-discipline — клиент создаётся только через createAnthropic()', () => {
  it('ни один production .ts не должен делать new Anthropic() напрямую', () => {
    const files = walk(ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
      if (ALLOWED_FILES.has(rel)) continue;
      if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
      const content = readFileSync(file, 'utf-8');
      if (FORBIDDEN.test(content)) violations.push(rel);
    }

    if (violations.length > 0) {
      throw new Error(
        `Прямой new Anthropic() в production коде:\n  ${violations.join('\n  ')}\n\n` +
          `Используй createAnthropic() из lib/anthropic.ts (timeout + maxRetries). ` +
          `Bug history C2: дефолтный 600с timeout → запрос висел до 10 мин, забивая пул.`,
      );
    }
    expect(violations).toEqual([]);
  });
});
