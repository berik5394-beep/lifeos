import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldOverwriteContent, computeExpiresAt, mergeDetails } from './memory-service.js';

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

describe('computeExpiresAt — TTL defaults для эпизодических типов', () => {
  const NOW = new Date('2026-05-28T12:00:00Z');

  it('event → +30 дней', () => {
    const exp = computeExpiresAt('event', NOW);
    expect(exp).not.toBeNull();
    const days = Math.round(
      (exp!.getTime() - NOW.getTime()) / 86_400_000,
    );
    expect(days).toBe(30);
  });

  it('emotion → +14 дней', () => {
    const exp = computeExpiresAt('emotion', NOW);
    expect(exp).not.toBeNull();
    const days = Math.round(
      (exp!.getTime() - NOW.getTime()) / 86_400_000,
    );
    expect(days).toBe(14);
  });

  it.each(['fact', 'preference', 'person', 'decision', 'place'])(
    '%s → null (forever, не транзиентный тип)',
    (type) => {
      expect(computeExpiresAt(type, NOW)).toBeNull();
    },
  );

  it('unknown type → null (safe default)', () => {
    expect(computeExpiresAt('xyz', NOW)).toBeNull();
  });
});

const SRC = readFileSync(
  join(process.cwd(), 'src/services/memory-service.ts'),
  'utf-8',
);

// M3 Unit A: captureMemory удалён; guard+audit перенесены в writeMemory
// (episodic-memory.ts). Структурную регрессию проверяем там.
const WRITE_SRC = readFileSync(
  join(process.cwd(), 'src/services/episodic-memory.ts'),
  'utf-8',
);

describe('writeMemory structural — guard + audit wired (Risk A+D, M3 Unit A)', () => {
  it('writeMemory зовёт shouldOverwriteContent в update-ветке', () => {
    expect(WRITE_SRC).toMatch(/shouldOverwriteContent\(.*content\)/s);
  });

  it('writeMemory логирует UPDATE через console.warn (audit trail)', () => {
    expect(WRITE_SRC).toMatch(/console\.warn\(\s*[\s\S]{0,40}\[memory\]\s*UPDATE/);
  });

  it('audit log включает длины content (диагностика sparse)', () => {
    const warnBlock = WRITE_SRC.slice(WRITE_SRC.indexOf('[memory] UPDATE'));
    expect(warnBlock).toContain('oldLen');
    expect(warnBlock).toContain('newLen');
    expect(warnBlock).toContain('contentReplaced');
  });
});

describe('mergeDetails (T5 sparse-guard на details)', () => {
  it('оба null → null', () => { expect(mergeDetails(null, null)).toBeNull(); });
  it('new null → старый сохраняется', () => {
    expect(mergeDetails('Серик — брат, познакомились в школе', null)).toBe('Серик — брат, познакомились в школе');
  });
  it('old null → берём новый', () => {
    expect(mergeDetails(null, 'новые детали')).toBe('новые детали');
  });
  it('оба есть, новый беднее (<70% длины) → оставляем старый', () => {
    const rich = 'Серик Жумабаев — брат, познакомились в школе в 2005';
    expect(mergeDetails(rich, 'Серик')).toBe(rich);
  });
  it('оба есть, новый богаче → берём новый', () => {
    const poor = 'Серик';
    const rich = 'Серик Жумабаев — брат, познакомились в школе';
    expect(mergeDetails(poor, rich)).toBe(rich);
  });
});
