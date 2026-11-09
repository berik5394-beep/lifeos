import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma as appPrisma } from '../../lib/prisma.js';
import { createDeal, updateDeal } from './service.js';

// Агент-цикл (модель) замокан: проверяем, что чат доходит до ответа и с какими инструментами.
const runAgent = vi.fn(async (_opts: { localTools?: boolean }) => 'ответ робота');
vi.mock('../claude-agent.js', () => ({ runAgent: (opts: { localTools?: boolean }) => runAgent(opts) }));
const { needsLocalTools, mayNeedLocalTools, mayNeedDealTools, handleMessage } = await import('../jarvis-orchestrator.js');

/**
 * Ревью I-b: живые фразы о сделке должны включать инструменты — по словарю
 * корней ИЛИ по имени клиента с открытой сделкой («как там Ахмет по оборудованию?»).
 */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => { process.env.FEATURE_V2_DEALS = 'all'; });
afterEach(() => { vi.restoreAllMocks(); });

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

const CHITCHAT = [
  'а насчёт фильма что думаешь?',
  'за счёт чего растут мышцы?',
  'какой счёт в матче Реала?',
  'перевёл статью на английский',
  'придумай предложение со словом кот',
  'я согласился с ним, ты прав',
  'тысяча чертей, ну и день',
  'скинул вес на 3 кг за месяц',
];

describe('ревью-3 I5: словарь сделок только при включённых сделках', () => {
  // 2026-11-09: общий словарь стал «инструменты по умолчанию, кроме болтовни»
  // (mayNeedLocalTools). Сделки по-прежнему НИЧЕГО не добавляют при выключенном
  // флаге: needsLocalTools == mayNeedLocalTools (+ привычки юзера).
  it('флаг off: словарь/имена сделок ничего не добавляют — needsLocalTools == mayNeedLocalTools', async () => {
    const userId = await user('off-corpus');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    process.env.FEATURE_V2_DEALS = '';
    for (const p of [...PHRASES, ...CHITCHAT, 'добавь задачу купить хлеб', 'расскажи анекдот про кота', 'как там Ахмет по оборудованию?']) {
      expect({ p, tools: await needsLocalTools(userId, p) }).toEqual({ p, tools: mayNeedLocalTools(p) });
    }
  });

  it('флаг on: болтовня/общие вопросы с «опасными» корнями — без инструментов (даже при открытой сделке)', async () => {
    const userId = await user('on-chat');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    for (const p of CHITCHAT.filter((t) => /\?$/.test(t) || /^придумай/.test(t))) {
      expect({ p, tools: await needsLocalTools(userId, p) }).toEqual({ p, tools: false });
    }
  });

  it('инструменты включает ТОЛЬКО имя клиента (словари молчат)', async () => {
    const userId = await user('name-only');
    const p = 'как там Ахмет по оборудованию?';
    expect(mayNeedLocalTools(p) || mayNeedDealTools(p)).toBe(false);
    expect(await needsLocalTools(userId, p)).toBe(false);
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    expect(await needsLocalTools(userId, p)).toBe(true);
  });

  it('сбой БД при поиске клиента → false, чат продолжается', async () => {
    const userId = await user('db-err');
    await createDeal(userId, { personName: 'Ахмет', title: 'оборудование' });
    const spy = vi.spyOn(appPrisma.deal, 'findMany').mockRejectedValue(new Error('db down'));
    expect(await needsLocalTools(userId, 'как там Ахмет по оборудованию?')).toBe(false);
    expect(spy).toHaveBeenCalled();
    runAgent.mockClear();
    const r = await handleMessage(userId, 'как там Ахмет по оборудованию?');
    expect(r.reply).toBe('ответ робота');
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent.mock.calls[0][0].localTools).toBe(false);
  });
});
