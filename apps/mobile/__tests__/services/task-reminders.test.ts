import { localTaskTime, planTaskReminders, remindersToCancel } from '@/services/task-reminders';

const T = (id: string, date: string, time: string | null, completed = false) => ({ id, title: `Задача ${id}`, date, time, completed });

describe('напоминания задач', () => {
  it('день задачи — по местному времени, и для «2026-11-06», и для ISO с полуночью UTC', () => {
    const want = new Date(2026, 10, 6, 9, 30);
    expect(localTaskTime('2026-11-06', '09:30')).toEqual(want);
    expect(localTaskTime('2026-11-06T00:00:00.000Z', '09:30')).toEqual(want);
    expect(localTaskTime('2026-11-06', 'потом')).toBeNull();
  });

  it('план: мягкое за 30 минут + будильник; прошлое, закрытые и без времени — нет', () => {
    const now = new Date(2026, 10, 6, 9, 10).getTime();
    const plan = planTaskReminders(
      [T('a', '2026-11-06', '09:30'), T('b', '2026-11-06', '08:00'), T('c', '2026-11-07', '10:00', true), T('d', '2026-11-07', null), T('e', '2026-11-07', '10:00')],
      now,
    );
    expect(plan.map((p) => p.identifier)).toEqual(['task-alarm-a', 'task-reminder-e', 'task-alarm-e']);
    expect(plan.find((p) => p.identifier === 'task-reminder-e')?.at).toEqual(new Date(2026, 10, 7, 9, 30));
  });

  it('снимаем только задачи из списка и старые будильники без id; задачи вне выборки не трогаем', () => {
    const scheduled = [
      { identifier: 'task-reminder-a', content: { title: 'Напоминание', data: { type: 'task' } } },
      { identifier: 'task-alarm-a', content: { title: 'Время: A', data: { type: 'alarm' } } },
      { identifier: 'task-reminder-next-month', content: { title: 'Напоминание', data: { type: 'task' } } },
      { identifier: 'task-alarm-next-month', content: { title: 'Время: Z', data: { type: 'alarm' } } },
      { identifier: '5F1C-random', content: { title: 'Время: A', data: { type: 'alarm' } } },
      { identifier: 'event-60-x', content: { title: 'Встреча', data: { type: 'event' } } },
      { identifier: 'R-voice', content: { title: 'LifeOS', data: { type: 'alarm' } } },
    ];
    expect(remindersToCancel(scheduled, new Set(['a']))).toEqual(['task-reminder-a', 'task-alarm-a', '5F1C-random']);
  });
});
