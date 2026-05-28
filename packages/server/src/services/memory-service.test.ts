import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldOverwriteContent } from './memory-service.js';

/**
 * memory-service hardening (Risk A — sparse-overwrite, 2026-05-28).
 *
 * Раньше: zero test coverage. captureMemory дедуп мог перезаписать
 * длинный rich content коротким sparse mention. Этот файл закрывает
 * gap двумя слоями:
 *  1) Pure decision shouldOverwriteContent (unit, без БД)
 *  2) Структурный lint в memory-service.ts — guard используется
 *     + audit console.warn существует (regression-proof)
 */

describe('shouldOverwriteContent — sparse-overwrite guard (Risk A)', () => {
  describe('REFUSE (предотвращает потерю данных)', () => {
    it('sparse 5 chars vs rich 45 chars → false', () => {
      expect(
        shouldOverwriteContent(
          'Серик Жумабаев — брат, познакомились в школе',
          'Серик',
        ),
      ).toBe(false);
    });

    it('новая 30% старой → false (значительно короче)', () => {
      // old 100 chars, new 25 chars (25%)
      const old = 'A'.repeat(100);
      const neu = 'B'.repeat(25);
      expect(shouldOverwriteContent(old, neu)).toBe(false);
    });

    it('новая ровно 60% старой → false (под порогом 70%)', () => {
      const old = 'A'.repeat(100);
      const neu = 'B'.repeat(60);
      expect(shouldOverwriteContent(old, neu)).toBe(false);
    });
  });

  describe('ALLOW (легитимный update)', () => {
    it('обе короткие (старая < 30) → true (обогащение)', () => {
      // "Серик" → "Серик Иванов" — старая sparse, новая длиннее
      expect(shouldOverwriteContent('Серик', 'Серик Иванов поставщик')).toBe(
        true,
      );
    });

    it('новая длиннее старой → true (enrichment)', () => {
      expect(
        shouldOverwriteContent(
          'Серик мой друг',
          'Серик мой лучший друг с детства',
        ),
      ).toBe(true);
    });

    it('новая такой же длины → true (rephrase)', () => {
      const old = 'Решил уволиться с работы в Kaspi';
      const neu = 'Решил уйти из Kaspi на свободу';
      expect(shouldOverwriteContent(old, neu)).toBe(true);
    });

    it('новая чуть короче (>= 70%) → true (acceptable trim)', () => {
      const old = 'A'.repeat(100);
      const neu = 'B'.repeat(75); // 75% — выше порога
      expect(shouldOverwriteContent(old, neu)).toBe(true);
    });

    it('обе равны 0 → true (edge)', () => {
      expect(shouldOverwriteContent('', '')).toBe(true);
    });
  });
});

const SRC = readFileSync(
  join(process.cwd(), 'src/services/memory-service.ts'),
  'utf-8',
);

describe('memory-service.ts structural — guard + audit wired (Risk A+D)', () => {
  it('captureMemory зовёт shouldOverwriteContent в update-ветке', () => {
    expect(SRC).toMatch(/shouldOverwriteContent\(.*content\)/s);
  });

  it('captureMemory логирует UPDATE через console.warn (audit trail)', () => {
    // Раньше silent — Risk D (UPDATE без следа). Теперь обязательно.
    expect(SRC).toMatch(/console\.warn\(\s*['`]\[memory\]\s*UPDATE/);
  });

  it('audit log включает id + длины content (диагностика sparse)', () => {
    const warnBlock = SRC.slice(SRC.indexOf('[memory] UPDATE'));
    expect(warnBlock).toContain('oldLen');
    expect(warnBlock).toContain('newLen');
    expect(warnBlock).toContain('contentReplaced');
  });
});
