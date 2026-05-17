import { describe, it, expect } from 'vitest';
import { daySlot } from './proactive-notifications.js';

/**
 * #4 — спам «питомец скучает» 16×. Корень: scheduledFor=now (каждый
 * тик новый → дедуп не срабатывал). daySlot — стабильный слот:
 * одинаков весь день → SentNotification(userId,type,scheduledFor)
 * дедупит до 1/день.
 */
describe('daySlot — стабильный слот дня', () => {
  it('ставит заданный час, обнуляет мин/сек/мс', () => {
    const s = daySlot(14);
    expect(s.getHours()).toBe(14);
    expect(s.getMinutes()).toBe(0);
    expect(s.getSeconds()).toBe(0);
    expect(s.getMilliseconds()).toBe(0);
  });
  it('два вызова подряд идентичны (дедуп сработает)', () => {
    expect(daySlot(12).getTime()).toBe(daySlot(12).getTime());
  });
  it('разные часы — разные слоты (типы не схлопываются)', () => {
    expect(daySlot(10).getTime()).not.toBe(daySlot(14).getTime());
  });
});
