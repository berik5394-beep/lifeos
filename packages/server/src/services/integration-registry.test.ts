import { describe, it, expect } from 'vitest';
import { INTEGRATIONS, getIntegration } from './integration-registry.js';

/**
 * Phase 3.3 — реестр как единый источник правды. Тестируем статическую
 * структуру (без БД): ключи провайдеров не разъезжаются, дескрипторы
 * самосогласованы. Это и есть «страховка от каши».
 */

describe('integration-registry', () => {
  it('getIntegration возвращает дескриптор по ключу', () => {
    expect(getIntegration('google_calendar')?.name).toBe('Google');
    expect(getIntegration('telegram')?.name).toBe('Telegram');
  });

  it('неизвестный провайдер → undefined (валидация на disconnect)', () => {
    expect(getIntegration('myspace')).toBeUndefined();
    expect(getIntegration('')).toBeUndefined();
  });

  it('ключ дескриптора совпадает с ключом в реестре (нет рассинхрона)', () => {
    for (const [key, d] of Object.entries(INTEGRATIONS)) {
      expect(d.key).toBe(key);
      expect(typeof d.isConnected).toBe('function');
      expect(typeof d.disconnect).toBe('function');
      expect(d.capabilities.length).toBeGreaterThan(0);
    }
  });

  it('google объединяет calendar+gmail в одной интеграции (один OAuth)', () => {
    const caps = getIntegration('google_calendar')!.capabilities;
    expect(caps).toContain('calendar_two_way_sync');
    expect(caps).toContain('gmail_triage');
  });
});
