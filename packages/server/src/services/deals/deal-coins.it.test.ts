import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createDeal, updateDeal } from './service.js';

/** Выигранная сделка → +50 монет один раз (refKey deal:<id>), любым путём. */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });

const NOW = new Date();
async function user(tag: string) {
  return (await prisma.user.create({ data: { email: `dcoin-${tag}-${Date.now()}@a.test`, name: 'C', passwordHash: 'x', timezone: 'UTC' } })).id;
}
const coins = (userId: string) => prisma.coinTransaction.findMany({ where: { userId }, select: { refKey: true, amount: true } });

describe('монеты за выигранную сделку', () => {
  it('выиграна → +50 один раз; вернули в работу и снова выиграли — всё ещё один раз', async () => {
    const userId = await user('win');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000 }, NOW);
    expect(await coins(userId)).toEqual([]);
    await updateDeal(userId, deal.id, { stage: 'won' }, NOW);
    expect(await coins(userId)).toEqual([{ refKey: `deal:${deal.id}`, amount: 50 }]);
    await updateDeal(userId, deal.id, { stage: 'talks' }, NOW);
    await updateDeal(userId, deal.id, { stage: 'won' }, NOW);
    await updateDeal(userId, deal.id, { amount: 2_500_000 }, NOW); // без смены стадии — не повод
    expect(await coins(userId)).toEqual([{ refKey: `deal:${deal.id}`, amount: 50 }]);
  });

  it('нит: создана сразу выигранной → без монет (не фармим созданием)', async () => {
    const userId = await user('created');
    await createDeal(userId, { personName: 'Серик', title: 'склад', stage: 'won', amount: 1_000_000 }, NOW);
    expect(await coins(userId)).toEqual([]);
  });

  it('нит: выиграна без суммы → без монет; сумму досказали → +50 один раз', async () => {
    const userId = await user('noamount');
    const { deal } = await createDeal(userId, { personName: 'Дана', title: 'склад' }, NOW);
    await updateDeal(userId, deal.id, { stage: 'won' }, NOW);
    expect(await coins(userId)).toEqual([]);
    await updateDeal(userId, deal.id, { amount: 700_000 }, NOW);
    expect(await coins(userId)).toEqual([{ refKey: `deal:${deal.id}`, amount: 50 }]);
    await updateDeal(userId, deal.id, { amount: 800_000 }, NOW);
    expect(await coins(userId)).toEqual([{ refKey: `deal:${deal.id}`, amount: 50 }]);
  });

  it('нит: проигранную сразу в «выиграна» — без монет (только из открытой стадии)', async () => {
    const userId = await user('lostwon');
    const { deal } = await createDeal(userId, { personName: 'Аля', title: 'z', amount: 100_000, stage: 'lost' }, NOW);
    await updateDeal(userId, deal.id, { stage: 'won' }, NOW);
    expect(await coins(userId)).toEqual([]);
  });

  it('проиграна / открыта — монет нет', async () => {
    const userId = await user('lost');
    const { deal } = await createDeal(userId, { personName: 'Дана', title: 'x' }, NOW);
    await updateDeal(userId, deal.id, { stage: 'proposal' }, NOW);
    await updateDeal(userId, deal.id, { stage: 'lost' }, NOW);
    await createDeal(userId, { personName: 'Аля', title: 'y', stage: 'lost' }, NOW);
    expect(await coins(userId)).toEqual([]);
  });
});
