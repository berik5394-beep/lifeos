import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resetDb } from './reset-db.js';

/**
 * Флейк 2026-11-07: habit-day «GET /habits/logs…» падал ~1 из 3 в общем прогоне
 * с `deadlock detected` из beforeEach → resetDb. Причина: прошлый тест оставил
 * фоновую запись (POST /habits/:id/log → `void onHabitDone` → awardCoins →
 * INSERT CoinTransaction), а очистка брала эксклюзивные замки таблиц по одной
 * (TRUNCATE): замок на User — у очистки, на CoinTransaction — у фоновой записи,
 * и каждая ждёт другую. Postgres через 1 с отменял очистку → тест красный.
 *
 * Здесь тот же расклад, но без гонки: транзакция «как фоновая запись» держит
 * свою таблицу, очистка стартует, транзакция идёт дальше по остальным таблицам.
 * Очистка обязана дождаться её и пройти — без дедлока и без мусора после.
 */
const writer = new PrismaClient();
const observer = new PrismaClient();
afterAll(() => Promise.all([writer.$disconnect(), observer.$disconnect()]));

async function waitUntilSomeoneWaitsOnLock(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const rows = await observer.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (rows[0].n > 0n) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('resetDb рядом с недописанной фоновой записью', () => {
  it('не дедлочится и после неё база пустая', async () => {
    const u = await writer.user.create({ data: { email: 'bg@reset.test', name: 'B', passwordHash: 'x' } });
    const tables = await writer.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;

    let release!: () => void;
    const holding = new Promise<void>((r) => { release = r; });
    let resetStarted!: () => void;
    const started = new Promise<void>((r) => { resetStarted = r; });

    const background = writer.$transaction(async (tx) => {
      await tx.coinTransaction.create({ data: { userId: u.id, refKey: 'bg', amount: 1, reason: 'фон' } });
      release();
      await started;
      await waitUntilSomeoneWaitsOnLock();
      // Фоновая запись идёт дальше и трогает остальные таблицы.
      for (const t of tables) await tx.$queryRawUnsafe(`SELECT 1 FROM "public"."${t.tablename}" LIMIT 1`);
    }, { timeout: 15_000 });

    await holding;
    const reset = resetDb(observer);
    resetStarted();

    const [bg, rs] = await Promise.allSettled([background, reset]);
    expect(bg.status === 'rejected' ? String(bg.reason) : 'ok').toBe('ok');
    expect(rs.status === 'rejected' ? String(rs.reason) : 'ok').toBe('ok');
    expect(await observer.user.count()).toBe(0);
    expect(await observer.coinTransaction.count()).toBe(0);
  });
});
