import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Structural lint — regression guard для бага 2026-05-28.
 *
 * Проект использует ENV `CLAUDE_API_KEY` (документировано в
 * .env.example + routes/quick-add.ts:14-15 коммент). Anthropic SDK
 * по умолчанию ищет `ANTHROPIC_API_KEY` — если использовать его
 * напрямую в коде, в проде ключа НЕТ → silent disable feature.
 *
 * Этот баг уже сработал в двух местах:
 *  - safety-classifier.ts → Tier-2 Haiku crisis отключён (SAFETY)
 *  - emotional-classifier.ts → Tier-2 emo отключён
 *
 * Тест ищет ANY использование ANTHROPIC_API_KEY в src/ — если кто-то
 * скопипастит SDK-сниппет с дефолтным именем, тест станет красным
 * ДО прод-деплоя.
 *
 * Разрешения: документация / коммент / тест-файл с явным маркером
 * (см. ALLOWED_MENTIONS) — для объяснения почему НЕ использовать.
 */

const ROOT = join(process.cwd(), 'src');
const FORBIDDEN = 'ANTHROPIC_API_KEY';

// Файлы где упоминание разрешено (объяснение бага, регрессия-тест):
const ALLOWED_FILES = new Set([
  // Этот тест-файл сам — содержит FORBIDDEN как строку для поиска
  'services/env-key-discipline.test.ts',
  // Bug-fix комментарий в routes/quick-add.ts объясняет почему НЕ использовать
  'routes/quick-add.ts',
  // То же в routes/prioritization.ts
  'routes/prioritization.ts',
  // lib/env-check.ts может упомянуть в комменте
  'lib/env-check.ts',
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

describe('env-key-discipline — проект использует CLAUDE_API_KEY, не ANTHROPIC_API_KEY', () => {
  it(`ни один production .ts файл не должен использовать ${FORBIDDEN} напрямую`, () => {
    const files = walk(ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
      if (ALLOWED_FILES.has(rel)) continue;
      const content = readFileSync(file, 'utf-8');
      if (content.includes(FORBIDDEN)) {
        violations.push(rel);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ${FORBIDDEN} in: ${violations.join(', ')}. ` +
          `Project uses CLAUDE_API_KEY (см. .env.example). ` +
          `Anthropic SDK дефолтный ENV-name — баг-trap: ключа нет в Railway env, ` +
          `feature тихо отключается. Используй process.env.CLAUDE_API_KEY.`,
      );
    }
    expect(violations).toEqual([]);
  });
});
