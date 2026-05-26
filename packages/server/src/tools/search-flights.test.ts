import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { searchFlightsTool } from './search-flights.js';

/**
 * Phase 7 — Travelpayouts (Aviasales) search_flights tool tests.
 * Без сети, без mock'ов fetch — проверяем только graceful fallback
 * branches (not_configured, invalid_input) которые срабатывают ДО
 * HTTP call.
 *
 * Real API integration test — отдельно, не в этом suite.
 */

const ctx = { userId: 'u-test' };

describe('search_flights — graceful fallback без env', () => {
  let savedToken: string | undefined;

  beforeEach(() => {
    savedToken = process.env.TRAVELPAYOUTS_TOKEN;
    delete process.env.TRAVELPAYOUTS_TOKEN;
  });

  afterEach(() => {
    if (savedToken !== undefined) process.env.TRAVELPAYOUTS_TOKEN = savedToken;
  });

  it('без TRAVELPAYOUTS_TOKEN → structured not_configured (НЕ throw)', async () => {
    const result = await searchFlightsTool.handler(
      {
        origin: 'ALA',
        destination: 'MOW',
        departureAt: '2026-07-15',
      },
      ctx,
    );
    expect(result).toMatchObject({
      connected: false,
      reason: 'not_configured',
    });
    expect((result as { message: string }).message).toContain('Berik');
  });

  it('invalid IATA (не 3 буквы) → zod schema rejects (до handler)', async () => {
    // schema.parse валидирует input ДО handler. zod выбрасывает на min/max.
    const parseResult = searchFlightsTool.schema.safeParse({
      origin: 'AL', // 2 буквы
      destination: 'MOW',
      departureAt: '2026-07-15',
    });
    expect(parseResult.success).toBe(false);
  });

  it('invalid дата формата (не YYYY-MM-DD) → zod rejects', async () => {
    const parseResult = searchFlightsTool.schema.safeParse({
      origin: 'ALA',
      destination: 'MOW',
      departureAt: '15-07-2026', // wrong format
    });
    expect(parseResult.success).toBe(false);
  });

  it('валидный input + нет токена → graceful (полный flow)', async () => {
    const parseResult = searchFlightsTool.schema.safeParse({
      origin: 'ALA',
      destination: 'NQZ',
      departureAt: '2026-08-01',
      returnAt: '2026-08-10',
      currency: 'KZT',
    });
    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      const result = await searchFlightsTool.handler(parseResult.data, ctx);
      // Без токена → structured not_configured
      expect((result as { connected: boolean }).connected).toBe(false);
    }
  });
});

describe('search_flights tool — registry consistency', () => {
  it('name = search_flights', () => {
    expect(searchFlightsTool.name).toBe('search_flights');
  });
  it('needsConfirm = false (read-only поиск, не money/external write)', () => {
    expect(searchFlightsTool.needsConfirm).toBe(false);
  });
  it('sideEffects = external (HTTP call)', () => {
    expect(searchFlightsTool.sideEffects).toBe('external');
  });
  it('category = travel', () => {
    expect(searchFlightsTool.category).toBe('travel');
  });
  it('examples непустые (для агента)', () => {
    expect(searchFlightsTool.examples?.length).toBeGreaterThan(0);
  });
});
