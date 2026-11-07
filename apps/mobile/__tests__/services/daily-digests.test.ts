jest.mock('@/services/notifications', () => ({
  cancelLocalDigests: jest.fn(async () => {}),
  scheduleMorningBriefing: jest.fn(async () => 'id'),
  scheduleEveningReview: jest.fn(async () => 'id'),
  scheduleWeeklyReport: jest.fn(async () => 'id'),
}));
import * as N from '@/services/notifications';
import { storage } from '@/services/storage';
import { syncDailyDigests, resyncDailyDigests } from '@/services/daily-digests';

const n = N as jest.Mocked<typeof N>;
beforeEach(() => jest.clearAllMocks());

describe('одна утренняя сводка, а не три', () => {
  it('пуш с сервера есть → локальные сводки сняты, новых нет', async () => {
    expect(await syncDailyDigests(true)).toBe('server');
    expect(n.cancelLocalDigests).toHaveBeenCalled();
    expect(n.scheduleMorningBriefing).not.toHaveBeenCalled();
  });
  it('пуша нет → одна локальная по времени из настроек (по умолчанию 07:00, не 08:00)', async () => {
    storage.remove('wakeUpTime');
    await syncDailyDigests(false);
    expect(n.scheduleMorningBriefing).toHaveBeenCalledWith('07:00');
  });
  it('смена времени подъёма без пуша → утро на новое время', async () => {
    await syncDailyDigests(false);
    await resyncDailyDigests('06:15');
    expect(n.scheduleMorningBriefing).toHaveBeenLastCalledWith('06:15');
  });
});
