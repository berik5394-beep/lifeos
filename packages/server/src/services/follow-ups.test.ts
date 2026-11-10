import { describe, it, expect } from 'vitest';
import { eventFinishedToday, formatFollowUp, isHeavy, isSignificant } from './follow-ups.js';

/** «Незакрытое» (аудит 2026-11-10): о чём друг спросит «как прошло?». */
describe('follow-ups — чистые части', () => {
  it('значимое vs рутина', () => {
    for (const t of ['Собеседование в Kaspi', 'Экзамен по праву', 'Операция мамы', 'Стоматолог', 'Переезд', 'Встреча с инвестором']) expect(isSignificant(t), t).toBe(true);
    for (const t of ['Планёрка', 'Созвон с командой', 'Купить хлеб', 'Встреча с поставщиком', 'Отчёт']) expect(isSignificant(t), t).toBe(false);
  });
  it('тяжёлое', () => {
    expect(isHeavy('Операция мамы')).toBe(true);
    expect(isHeavy('Поссорилась с братом — тяжело')).toBe(true);
    expect(isHeavy('Собеседование в Kaspi')).toBe(false);
  });
  it('сегодняшнее событие — только когда закончилось (+1 ч)', () => {
    expect(eventFinishedToday('10:00', '11:00', 11, 30)).toBe(false);
    expect(eventFinishedToday('10:00', '11:00', 12, 0)).toBe(true);
    expect(eventFinishedToday('10:00', null, 12, 0)).toBe(true); // начало+1ч+1ч
    expect(eventFinishedToday(null, null, 23, 0)).toBe(false); // весь день — завтра
  });
  it('строка для мозга: бодро о событии, бережно о тяжёлом', () => {
    expect(formatFollowUp({ refKey: 'event:1', text: 'Собеседование в Kaspi', kind: 'event', daysAgo: 1, heavy: false })).toMatch(/вчера.*как прошло/s);
    const heavy = formatFollowUp({ refKey: 'mem:1', text: 'Поссорилась с братом — тяжело', kind: 'concern', daysAgo: 2, heavy: true });
    expect(heavy).toContain('его тревожило');
    expect(heavy).toContain('очень бережно');
  });
});

describe('C: робот спросил о теме?', () => {
  it('вопрос с темой (с другим окончанием) — да; без вопроса или про другое — нет', async () => {
    const { mentionsTopic } = await import('./follow-ups.js');
    expect(mentionsTopic('Собеседование в Kaspi', 'Привет! Как прошло собеседование в Kaspi?')).toBe(true);
    expect(mentionsTopic('Собеседование в Kaspi', 'Привет! Как там твоё собеседовании, рассказывай?')).toBe(true);
    expect(mentionsTopic('Собеседование в Kaspi', 'Собеседование уже было. Чем займёмся сегодня?')).toBe(false);
    expect(mentionsTopic('Собеседование в Kaspi', 'Как ты сегодня?')).toBe(false);
    expect(mentionsTopic('Поссорилась с братом из-за денег — тяжело', 'Как вы с братом, помирились?')).toBe(true);
  });
});
