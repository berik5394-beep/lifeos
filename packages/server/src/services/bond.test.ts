import { describe, it, expect } from 'vitest';
import { ACQUAINTANCE_TOPICS, daysTogether, daysWord, formatBondSection, unknownTopics } from './bond.js';

/** «Наша связь» (2026-11-10): друг помнит историю, незакрытое и делится своим. */
describe('bond — чистые части', () => {
  it('склонение дней', () => {
    expect(daysWord(1)).toBe('1 день');
    expect(daysWord(22)).toBe('22 дня');
    expect(daysWord(11)).toBe('11 дней');
    expect(daysWord(47)).toBe('47 дней');
    expect(daysWord(101)).toBe('101 день');
  });
  it('сколько знакомы по календарю', () => {
    expect(daysTogether(new Date('2026-09-24T00:00:00Z'), new Date('2026-11-10T00:00:00Z'))).toBe(47);
    expect(daysTogether(new Date('2026-11-10T00:00:00Z'), new Date('2026-11-10T00:00:00Z'))).toBe(0);
  });
  it('блок: история, круглая дата, незакрытое, дневник — только что есть', () => {
    const full = formatBondSection({
      days: 30,
      since: new Date('2026-10-11T00:00:00Z'),
      milestone: 30,
      thread: { refKey: 'event:e1', text: 'Собеседование в Kaspi', kind: 'event', daysAgo: 1, heavy: false },
      diary: 'Сегодня Алия закрыла презентацию — мне запомнилось, как она радовалась.',
    });
    expect(full).toContain('вы знакомы 30 дней (с 11 октября)');
    expect(full).toContain('Сегодня ровно 30 дней знакомства');
    expect(full).toContain('у него было: «Собеседование в Kaspi» (вчера)');
    expect(full).toContain('Твоя запись в дневнике');
    const bare = formatBondSection({ days: 3, since: new Date('2026-11-07T00:00:00Z'), milestone: null, thread: null, diary: null });
    expect(bare).toBe('Наша история: вы знакомы 3 дня (с 7 ноября).');
    expect(formatBondSection({ days: 0, since: new Date(), milestone: null, thread: null, diary: null })).toMatch(/с сегодняшнего дня/);
  });
});

describe('знакомство в первую неделю', () => {
  it('новичок — не знаем ничего; узнали близких и работу — их больше не спрашиваем', () => {
    expect(unknownTopics({ people: 0, memories: [], goals: 0 })).toEqual(['people', 'work', 'priority', 'worry', 'joy']);
    expect(
      unknownTopics({
        people: 1,
        memories: [
          { type: 'fact', content: 'Работает аналитиком в Kaspi' },
          { type: 'emotion', content: 'Волнуется из-за переезда' },
        ],
        goals: 1,
      }),
    ).toEqual(['joy']);
  });
  it('блок просит спросить об ОДНОЙ теме и не анкетой', () => {
    const b = formatBondSection({
      days: 1, since: new Date('2026-11-09T00:00:00Z'), milestone: null, thread: null, diary: null,
      unknown: [ACQUAINTANCE_TOPICS.people, ACQUAINTANCE_TOPICS.work],
    });
    expect(b).toContain('Вы ещё знакомитесь');
    expect(b).toContain('кто его близкие');
    expect(b).toContain('об ОДНОЙ из этих тем');
  });
});

describe('один вопрос и настройки человека (D, E — 2026-11-10)', () => {
  const base = { days: 3, since: new Date('2026-11-07T00:00:00Z'), milestone: null, diary: null };
  const thread = { refKey: 'event:1', text: 'Собеседование', kind: 'event' as const, daysAgo: 1, heavy: false };
  it('есть незакрытое — знакомство в этот раз не подсказываем', () => {
    const b = formatBondSection({ ...base, thread, unknown: ['кто его близкие'] });
    expect(b).toContain('Собеседование');
    expect(b).not.toContain('Вы ещё знакомитесь');
    expect(formatBondSection({ ...base, thread: null, unknown: ['кто его близкие'] })).toContain('Вы ещё знакомитесь');
  });
  it('выключены «как ты?» / режим поддержки — сам не расспрашивает', () => {
    expect(formatBondSection({ ...base, thread: null, quiet: 'no-checkins' })).toContain('выключил вопросы «как ты?»');
    expect(formatBondSection({ ...base, thread: null, quiet: 'no-support' })).toContain('выключил режим поддержки');
  });
});
