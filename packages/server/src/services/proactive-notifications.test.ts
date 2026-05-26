import { describe, it, expect } from 'vitest';
import { daySlot } from './proactive-notifications.js';

/**
 * #4 — спам «питомец скучает» 16×. Корень: scheduledFor=now (каждый
 * тик новый → дедуп не срабатывал). daySlot — стабильный слот:
 * одинаков весь день → SentNotification(userId,type,scheduledFor)
 * дедупит до 1/день.
 *
 * Phase 7 P3 (2026-05-26) — daySlot стал TZ-aware (раньше evening
 * у Asia/Almaty юзера = 02:00 ночи UTC-server-local). Сигнатура:
 * daySlot(hour, tz). Тесты сравнивают через UTC-инстант (.getTime()),
 * НЕ через getHours() (он server-local — нестабилен между средами).
 */
describe('daySlot — TZ-aware стабильный слот дня', () => {
  it('UTC: 14:00 = полночь UTC + 14h', () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const expected = today.getTime() + 14 * 3_600_000;
    expect(daySlot(14, 'UTC').getTime()).toBe(expected);
  });

  it('Asia/Almaty (UTC+5): 14:00 локально = 09:00 UTC', () => {
    // 14:00 Almaty = 09:00 UTC. Разница со UTC слотом 14:00 = 5h
    const utcSlot = daySlot(14, 'UTC').getTime();
    const almatySlot = daySlot(14, 'Asia/Almaty').getTime();
    expect(utcSlot - almatySlot).toBe(5 * 3_600_000);
  });

  it('два вызова подряд идентичны (дедуп сработает)', () => {
    expect(daySlot(12, 'UTC').getTime()).toBe(daySlot(12, 'UTC').getTime());
  });

  it('разные часы — разные слоты (типы не схлопываются)', () => {
    expect(daySlot(10, 'UTC').getTime()).not.toBe(
      daySlot(14, 'UTC').getTime(),
    );
  });

  it('минуты/секунды/мс = 0 (для UTC)', () => {
    const ts = daySlot(14, 'UTC');
    expect(ts.getUTCMinutes()).toBe(0);
    expect(ts.getUTCSeconds()).toBe(0);
    expect(ts.getUTCMilliseconds()).toBe(0);
  });
});
