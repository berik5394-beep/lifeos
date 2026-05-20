import { describe, it, expect } from 'vitest';
import { timeToDate } from './proactive-notifications.js';

/**
 * Phase 6 ops-fix — timeToDate tz-корректен (W11-класс).
 * Регресс: «07:00» интерпретировалось как 07:00 UTC = 12:00 Almaty —
 * юзер получал «доброе утро» в полдень. Этот тест зафиксирует фикс.
 */

describe('timeToDate(time, tz) — W11 tz-correctness', () => {
  it('07:00 Asia/Almaty (UTC+5, без DST) = 02:00 UTC сегодня', () => {
    const d = timeToDate('07:00', 'Asia/Almaty');
    expect(d.getUTCHours()).toBe(2);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it('08:30 Asia/Almaty = 03:30 UTC', () => {
    const d = timeToDate('08:30', 'Asia/Almaty');
    expect(d.getUTCHours()).toBe(3);
    expect(d.getUTCMinutes()).toBe(30);
  });

  it('07:00 UTC tz = 07:00 UTC (тождество для server-tz)', () => {
    const d = timeToDate('07:00', 'UTC');
    expect(d.getUTCHours()).toBe(7);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it('tz обязателен (структурная защита): UTC explicit передаётся явно', () => {
    // Раньше был fallback без tz (серверное) — УБРАН специально,
    // чтобы TS-компилятор ловил рецидив. Если нет user.timezone —
    // caller обязан явно передать "UTC" с обоснованием.
    const d = timeToDate('07:00', 'UTC');
    expect(d.getUTCHours()).toBe(7);
  });
});
