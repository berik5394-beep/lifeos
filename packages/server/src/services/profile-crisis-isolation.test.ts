import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 6 C2 ↔ C1(d) ИНВАРИАНТ (провал-инвариант спеки #6):
 * кризис-сообщения НЕ участвуют в синтезе профиля. profile-
 * synthesizer — НОВЫЙ читатель ChatMessage → ОБЯЗАН crisis=false
 * в КАЖДОМ обращении (count + findMany). Source-parse, refactor-
 * proof: уберут фильтр — тест красный (как crisis-isolation.test,
 * класс money-not-in-agent-loop).
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/services/profile-synthesizer.ts'),
  'utf-8',
);

describe('profile crisis-isolation — synth НЕ читает crisis-ходы', () => {
  it('каждое обращение к chatMessage несёт crisis:false', () => {
    // Находим все chatMessage.<op>({ ... }) и проверяем, что в where
    // есть crisis: false. Грубо, но ловит регресс надёжно.
    const calls = [...SRC.matchAll(/chatMessage\.(count|findMany)\(/g)];
    expect(calls.length, 'есть обращения к chatMessage').toBeGreaterThan(0);
    for (const m of calls) {
      const slice = SRC.slice(m.index, m.index + 220);
      expect(
        /crisis:\s*false/.test(slice),
        `chatMessage.${m[1]} без crisis:false — кризис утечёт в профиль`,
      ).toBe(true);
    }
  });

  it('нет чтения ChatMessage без crisis-фильтра рядом', () => {
    // Доп. страховка: каждое вхождение "chatMessage." сопровождается
    // crisis:false в пределах вызова.
    const count = (SRC.match(/chatMessage\./g) ?? []).length;
    const guarded = (SRC.match(/crisis:\s*false/g) ?? []).length;
    expect(guarded).toBeGreaterThanOrEqual(count);
  });
});
