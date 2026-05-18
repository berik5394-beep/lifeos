import { describe, it, expect, vi, afterEach } from 'vitest';
import { convertCurrency, getWeather } from './external-apis.js';
import { ExternalApiError } from '../lib/errors.js';

/**
 * SSOT P0 mock-labels — trust invariant.
 *
 * Принцип bug #1: функция НЕ отдаёт численный результат (курс,
 * температуру), выглядящий настоящим, когда реального источника нет.
 * Раньше при сбое API: convertCurrency возвращал хардкод-курс
 * «as of 2025», getWeather — temp:0 или погоду Алматы под чужим
 * именем. Теперь — честное падение (ExternalApiError). Удаление
 * fallback сильнее любых меток: не существующий код не врёт.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const fetchFails = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network down');
    }),
  );

describe('convertCurrency — без реального курса не выдумывает', () => {
  it('одинаковая валюта → rate:1 (реально, без сети)', async () => {
    const r = await convertCurrency(100, 'KZT', 'KZT');
    expect(r.rate).toBe(1);
    expect(r.converted).toBe(100);
  });

  it('API недоступен → бросает ExternalApiError, НЕ фейковый курс', async () => {
    fetchFails();
    await expect(convertCurrency(100, 'USD', 'KZT')).rejects.toBeInstanceOf(
      ExternalApiError,
    );
  });

  it('реальный ответ API → курс из источника', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ rates: { KZT: 47000 } }),
      })),
    );
    const r = await convertCurrency(100, 'USD', 'KZT');
    expect(r.converted).toBe(47000);
    expect(r.rate).toBeGreaterThan(0);
  });
});

describe('getWeather — без данных не выдумывает погоду', () => {
  it('неизвестный город + геокодинг упал → бросает, НЕ погода Алматы', async () => {
    fetchFails();
    await expect(
      getWeather('Город-Которого-Нет-12345'),
    ).rejects.toBeInstanceOf(ExternalApiError);
  });

  it('известный город, но forecast API упал → бросает, НЕ temp:0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    await expect(getWeather('Алматы')).rejects.toBeInstanceOf(
      ExternalApiError,
    );
  });
});
