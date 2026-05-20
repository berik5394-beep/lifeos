import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Структурный lint — запрет `\b` в коде рядом с кириллицей.
 *
 * JS `\b` — ASCII-only word-boundary; с кириллицей silent-fail
 * (3 рецидива за Phase 5+6: classifyGoal, safety-classifier,
 * emotional-classifier, плюс мёртвая Haiku-проверка «да» в обоих
 * классификаторах + orchestrator isTelegramDataRequest). Этот тест
 * физически закрывает класс — если кто-то добавит `\b` рядом с
 * кириллицей в исходниках, билд краснеет.
 *
 * АЛЬТЕРНАТИВА (которую и надо использовать): lib/cyrillic-regex.ts
 * — cyrillicWord / containsAny — или multi-word phrase-специфичность
 * без \b вообще.
 */

const ROOT = join(process.cwd(), 'src');
const SKIP = new Set([
  // сам lint и helper-обвязка — естественно содержат упоминания \b
  'lib/cyrillic-regex.ts',
  'lib/cyrillic-regex.test.ts',
  'lib/no-bare-b-cyrillic.test.ts',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Удаляет //-комментарии и /* ... *\/ блоки из строки/файла. */
function stripComments(src: string): string {
  // блочные /* ... */
  let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // построчные //
  s = s.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return s;
}

const CYR = /[а-яёА-ЯЁ]/;

describe('lint: no \\b adjacent to Cyrillic in source regex', () => {
  it('исходники src/** без \\b рядом с кириллицей (3rd-recurrence guard)', () => {
    const files = walk(ROOT).filter(
      (f) => !SKIP.has(relative(ROOT, f)),
    );
    const offenders: string[] = [];
    for (const f of files) {
      const raw = readFileSync(f, 'utf-8');
      const clean = stripComments(raw);
      const lines = clean.split(/\r?\n/);
      const rawLines = raw.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (!line.trim()) return;
        if (line.includes('\\b') && CYR.test(line)) {
          offenders.push(
            `${relative(process.cwd(), f)}:${idx + 1}: ${rawLines[idx]?.trim() ?? ''}`,
          );
        }
      });
    }
    expect(
      offenders,
      offenders.length
        ? `Найден \\b рядом с кириллицей — используй lib/cyrillic-regex (multi-word без \\b или cyrillicWord):\n${offenders.join('\n')}`
        : '',
    ).toEqual([]);
  });
});
