import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { needsLocalTools } from '../jarvis-orchestrator.js';
import { createDeal, updateDeal } from './service.js';

/**
 * Ревью I-b: живые фразы о сделке должны включать инструменты — по словарю
 * корней ИЛИ по имени клиента с открытой сделкой («как там Ахмет по оборудованию?»).
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });

async function user(tag: string) {
  return (await prisma.user.create({ data: { email: `dtg-${tag}-${Date.now()}-${Math.random()}@a.test`, name: 'G', passwordHash: 'x', timezone: 'UTC' } })).id;
}

const PHRASES = [
  'Ахмет хочет оборудование на 500 тысяч',
  'Дана хочет склад за 800к',
  'отправил Ахмету предложение',
  'Ахмет подписал контракт',
  'Ахмет согласился на условия',
  'Ахмет перевёл 500 000',
  'Дана выставила счёт, ждём',
  'Ахмет передумал брать склад',
  'как там Ахмет по оборудованию?',
];

describe('инструменты на живые фразы о сделках', () => {
  it('все фразы → инструменты (открытая сделка с Ахметом)', async () => {
    const userId = await user('all');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    for (const p of PHRASES) expect({ p, tools: await needsLocalTools(userId, p) }).toEqual({ p, tools: true });
  });

  it('падежи имени: «как дела у Ахмета?» → инструменты', async () => {
    const userId = await user('case');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    expect(await needsLocalTools(userId, 'как дела у Ахмета с этим?')).toBe(true);
  });

  it('сделка закрыта → «как там Ахмет по оборудованию?» без инструментов', async () => {
    const userId = await user('closed');
    const { deal } = await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    await updateDeal(userId, deal.id, { stage: 'lost' });
    expect(await needsLocalTools(userId, 'как там Ахмет по оборудованию?')).toBe(false);
  });

  it('флаг off → по имени клиента не включаем', async () => {
    const userId = await user('off');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    process.env.FEATURE_V2_DEALS = '';
    expect(await needsLocalTools(userId, 'как там Ахмет по оборудованию?')).toBe(false);
  });

  it('болтовня без имени клиента → без инструментов', async () => {
    const userId = await user('chat');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    expect(await needsLocalTools(userId, 'расскажи анекдот про кота')).toBe(false);
  });
});
