import { describe, it, expect } from 'vitest';
import { buildStartGreeting, dayLine } from './conversation-greeting.js';
import type { GatheredContext } from './assistant-service.js';

/** Час — пользователя, не сервера: на Railway (UTC) в Алматы в 8 утра было «Доброй ночи». */
const gathered = {
  context: { userName: 'Берик', assistantStyle: 'friendly', assistantGender: 'female', upcomingEvents: [], todayTasks: [], habitsProgress: { total: 0, completed: 0 } },
  counts: { tasksToday: 3, tasksCompleted: 1, currentStreak: 0 },
} as unknown as GatheredContext;

describe('приветствие первой сессии дня', () => {
  it('8 утра пользователя → «Доброе утро» и утренние кнопки', () => {
    const g = buildStartGreeting(gathered, true, 8);
    expect(g?.text).toMatch(/^Доброе утро, Берик/);
    expect(g?.suggestions).toContain('Какие планы на сегодня?');
  });
  it('19:00 → «Добрый вечер»; 2 ночи → «Доброй ночи»', () => {
    expect(buildStartGreeting(gathered, true, 19)?.text).toMatch(/^Добрый вечер/);
    expect(buildStartGreeting(gathered, true, 2)?.text).toMatch(/^Доброй ночи/);
  });
  it('не первая сессия → без приветствия', () => {
    expect(buildStartGreeting(gathered, false, 8)).toBeNull();
  });
});


describe('dayLine — строка про задачи в приветствии разговора', () => {
  it('ноль задач — не «все выполнены»', () => {
    expect(dayLine(0, 0, 'Осталось', 'Все задачи выполнены!')).toBe(' Задач на сегодня нет.');
  });
  it('есть незакрытые — сколько из скольких', () => {
    expect(dayLine(5, 2, 'Осталось', 'Все задачи выполнены!')).toBe(' Осталось: 2 из 5.');
  });
  it('все закрыты — хвалим', () => {
    expect(dayLine(3, 0, 'Осталось', 'Все задачи выполнены!')).toBe(' Все задачи выполнены!');
  });
});
