import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * intent-TZ фикс — структурные гарды мест, где реальный путь требует Claude
 * (сеть/ключ) и it-тестом не покрывается: Claude-промпты экстракторов,
 * voice-fallback, booking/дикт-фоллбэки оркестратора. Серверная UTC-дата
 * («toISOString→YYYY-MM-DD» как «сегодня») здесь больше не должна появиться.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const UTC_TODAY = /new Date\(\)\.toISOString\(\)\.(?:split\('T'\)\[0\]|slice\(0, ?10\))|Date\.now\(\) \+ 86_400_000\)\.toISOString/;

describe('intent-TZ wiring', () => {
  it('voice-pipeline: fallback-задача и parseIntent — в поясе юзера', () => {
    const src = read('src/ai/voice-pipeline.ts');
    expect(src).not.toMatch(UTC_TODAY);
    expect(src).toMatch(/parseIntent\(raw, tz\)/);
  });
  it('routes/voice: processVoiceCommand получает пояс юзера', () => {
    expect(read('src/routes/voice.ts')).toMatch(/processVoiceCommand\(text, await getUserTimezone\(userId\)\)/);
  });
  it('dictation-service: промпты и фоллбэк-даты задач — по civilDayRefs/localDateStr', () => {
    const src = read('src/services/dictation-service.ts');
    expect(src).not.toMatch(UTC_TODAY);
    expect(src.match(/civilDayRefs\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('orchestrator: parseIntent/экстракторы/booking получают tz юзера', () => {
    const src = read('src/services/jarvis-orchestrator.ts');
    expect(src).not.toMatch(UTC_TODAY);
    expect(src).toMatch(/parseIntent\(text, userTz\)/);
    expect(src).toMatch(/isV2SupersedeEnabled\(userId\), tz \}/);
    expect(src).toMatch(/extractFromTranscript\(text, [^\n]*, tz\)/);
  });
  it('smart-booking: завтра/послезавтра от todayIso юзера, не от часов сервера', () => {
    const src = read('src/services/smart-booking.ts');
    expect(src).not.toMatch(/Date\.now\(\) \+ (?:2 \* )?86_400_000\)\.toISOString/);
    expect(src).toMatch(/addCivilDays\(todayIso, 1\)/);
    expect(src).toMatch(/addCivilDays\(todayIso, 2\)/);
  });
  it('assistant-service: фоллбэк parseIntent тоже в поясе юзера', () => {
    expect(read('src/services/assistant-service.ts')).toMatch(/parseIntent\(text, /);
  });
});
