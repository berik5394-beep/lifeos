import { describe, it, expect, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { captureTimezone } from './tz-capture.js';

/**
 * Real-Time Foundation — captureTimezone пишет НАСТОЯЩИЙ пояс устройства в
 * User.timezone. Реальный путь (real prisma, тест-БД), zero vi.mock.
 */
const prisma = new PrismaClient();
const KEY = 'FEATURE_V2_REALTIME';

function mkUser(email: string, timezone = 'Asia/Almaty') {
  return prisma.user.create({
    data: { email, name: 'T', passwordHash: 'x', timezone },
  });
}

describe('captureTimezone — фиксация пояса из X-Timezone', () => {
  afterEach(() => {
    delete process.env[KEY];
  });

  it('валидный пояс при флаге → User.timezone обновлён', async () => {
    process.env[KEY] = 'all';
    const u = await mkUser('a@tz.test');
    await captureTimezone(u.id, 'Europe/Istanbul');
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.timezone).toBe('Europe/Istanbul');
  });

  it('тот же пояс снова → НЕ перезаписывает (cache, без write-storm)', async () => {
    process.env[KEY] = 'all';
    const u = await mkUser('b@tz.test');
    await captureTimezone(u.id, 'Europe/Istanbul'); // пишет + кэширует
    // внешняя смета пояса в БД — если хук снова напишет, затрёт это
    await prisma.user.update({
      where: { id: u.id },
      data: { timezone: 'Asia/Almaty' },
    });
    await captureTimezone(u.id, 'Europe/Istanbul'); // cache hit → НЕ пишет
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.timezone).toBe('Asia/Almaty'); // осталось внешнее значение
  });

  it('невалидный пояс → игнор (хранимый не тронут)', async () => {
    process.env[KEY] = 'all';
    const u = await mkUser('c@tz.test');
    await captureTimezone(u.id, 'Mars/Phobos');
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.timezone).toBe('Asia/Almaty');
  });

  it('флаг off → no-op (байт-идентично)', async () => {
    delete process.env[KEY];
    const u = await mkUser('d@tz.test');
    await captureTimezone(u.id, 'Europe/Istanbul');
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.timezone).toBe('Asia/Almaty');
  });

  it('cross-user: capture для A не трогает B', async () => {
    process.env[KEY] = 'all';
    const a = await mkUser('e@tz.test');
    const b = await mkUser('f@tz.test');
    await captureTimezone(a.id, 'Europe/Istanbul');
    const bAfter = await prisma.user.findUnique({ where: { id: b.id } });
    expect(bAfter?.timezone).toBe('Asia/Almaty');
  });
});
