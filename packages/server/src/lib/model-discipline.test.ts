import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Structural lint — regression guard для бага 2026-05-28.
 *
 * Production код использовал hardcoded имена моделей:
 *  - claude-haiku-4-20250514 — НИКОГДА не существовала в Anthropic API
 *    (404 → Tier-2 classifier тихо отключён)
 *  - claude-sonnet-4-20250514 — DEPRECATED 2026-06-15
 *
 * Теперь источник правды = `lib/models.ts` (MODELS константы).
 * Этот тест ищет ANY hardcoded `claude-` snapshot string в production
 * .ts файлах вне lib/models.ts → если кто-то скопипастит SDK-сниппет
 * с захардкоженным именем модели, CI красный ДО прод-деплоя.
 *
 * Разрешения:
 *  - lib/models.ts — единственный legitimate источник имён
 *  - этот тест-файл (содержит forbidden строки как regex pattern)
 *  - test файлы (мокают, реальную модель не зовут)
 */

const ROOT = join(process.cwd(), 'src');

// Pattern: claude-{anything}-NN (sonnet/haiku/opus + date OR generation suffix)
// Match: claude-sonnet-4-20250514, claude-haiku-4-5, claude-opus-4-7
const HARDCODED_MODEL_PATTERN = /['"`]claude-(?:opus|sonnet|haiku)-[\w-]+['"`]/g;

const ALLOWED_FILES = new Set([
  'lib/models.ts',
  'lib/model-discipline.test.ts',
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

describe('model-discipline — production использует MODELS из lib/models.ts', () => {
  it('ни один production .ts не должен содержать hardcoded claude-* model name', () => {
    const files = walk(ROOT);
    const violations: Array<{ file: string; matches: string[] }> = [];

    for (const file of files) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
      if (ALLOWED_FILES.has(rel)) continue;
      // Test files allowed — они мокают, реальную модель не зовут
      if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
      const content = readFileSync(file, 'utf-8');
      const matches = content.match(HARDCODED_MODEL_PATTERN);
      if (matches && matches.length > 0) {
        violations.push({ file: rel, matches: [...new Set(matches)] });
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}: ${v.matches.join(', ')}`)
        .join('\n');
      throw new Error(
        `Hardcoded Claude model names в production коде:\n${msg}\n\n` +
          `Используй MODELS.{sonnet|haiku|opus} из lib/models.ts. ` +
          `Bug history: claude-haiku-4-20250514 → 404 в проде, ` +
          `claude-sonnet-4-20250514 → deprecated 2026-06-15.`,
      );
    }
    expect(violations).toEqual([]);
  });
});
