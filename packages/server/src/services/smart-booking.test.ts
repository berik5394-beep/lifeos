import { describe, it, expect } from 'vitest';
import { tripReadiness, type BookingIntent } from './smart-booking.js';

/**
 * Сценарный gate — детерминированное ядро дисциплины концьержа.
 * (LLM-поведенческие сценарии — в smart-booking.eval.md, их нельзя
 * выдавать за unit-тест; здесь только чистая логика gate.)
 */
function intent(over: Partial<BookingIntent>): BookingIntent {
  return { type: 'flight', confidence: 0.9, rawText: 'x', ...over };
}

describe('tripReadiness', () => {
  it('taxi — всегда ready (gate только для поездок)', () => {
    expect(tripReadiness(intent({ type: 'taxi' })).ready).toBe(true);
  });

  it('flight без слотов — НЕ ready, перечисляет недостающее', () => {
    const r = tripReadiness(intent({ toCity: 'Бангкок', departDate: '2026-06-02' }));
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(
      expect.arrayContaining([
        'аэропорт вылета',
        'тип отдыха',
        'кто летит',
        'паспорт/виза подтверждены',
        'бюджет',
      ]),
    );
  });

  it('нет направления и дат — они в missing', () => {
    const r = tripReadiness(intent({}));
    expect(r.missing).toEqual(expect.arrayContaining(['направление', 'даты']));
  });

  it('все слоты собраны — ready', () => {
    const r = tripReadiness(
      intent({
        toCity: 'Самуи',
        departDate: '2026-06-02',
        fromExplicit: true,
        tripType: 'beach',
        travelers: 'couple',
        passportAck: true,
        budgetKnown: true,
      }),
    );
    expect(r).toEqual({ ready: true, missing: [] });
  });

  it('passportAck unknown/false блокирует план', () => {
    const r = tripReadiness(
      intent({
        toCity: 'Пхукет',
        departDate: '2026-06-02',
        fromExplicit: true,
        tripType: 'beach',
        travelers: 'solo',
        budgetKnown: true,
        // passportAck не задан → not ready
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('паспорт/виза подтверждены');
  });

  it('hotel — те же слоты обязательны', () => {
    const r = tripReadiness(intent({ type: 'hotel', city: 'Бали', checkIn: '2026-06-02' }));
    expect(r.ready).toBe(false);
  });
});
