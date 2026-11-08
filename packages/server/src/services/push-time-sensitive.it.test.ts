import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { deliverNotification, interruptionLevelFor } from './push-service.js';

/** Срочные уведомления (iOS Time Sensitive): встречи/задачи пробивают «Фокус», остальное — нет. */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
afterEach(() => vi.unstubAllGlobals());

const user = async () =>
  (
    await prisma.user.create({
      data: { email: `ts-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x', expoPushToken: 'ExponentPushToken[abc]' },
    })
  ).id;
const sent = (f: ReturnType<typeof vi.fn>) => JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));

describe('срочные уведомления', () => {
  it('встреча через час — time-sensitive', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: { status: 'ok' } }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const res = await deliverNotification(await user(), 'Через час: Встреча', 'Серик (клиент)…', { type: 'event_reminder_1h' });
    expect(res.push).toBe(true);
    expect(sent(f)).toMatchObject({ interruptionLevel: 'time-sensitive', sound: 'default' });
  });

  it('утренний бриф — обычный (не пробивает «Фокус»)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: { status: 'ok' } }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await deliverNotification(await user(), 'Доброе утро', '…', { type: 'morning_briefing' });
    expect(sent(f).interruptionLevel).toBeUndefined();
  });

  it('interruptionLevelFor', () => {
    expect(interruptionLevelFor('task_reminder_30m')).toBe('time-sensitive');
    expect(interruptionLevelFor('event_reminder_30m')).toBe('time-sensitive');
    expect(interruptionLevelFor('weekly_summary')).toBeUndefined();
    expect(interruptionLevelFor(undefined)).toBeUndefined();
  });
});
