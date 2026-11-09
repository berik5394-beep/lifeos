import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runRegistryTool } from './index.js';
import { peekPendingAction } from '../services/pending-actions.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function user(tag: string) {
  const u = await prisma.user.create({
    data: { email: `dtool-${tag}-${Date.now()}@a.test`, name: 'D', passwordHash: 'x', timezone: 'UTC' },
  });
  return u.id;
}
type Out = { message?: string; error?: string; ask?: string[] };

describe('инструменты сделок', () => {
  it('create_deal → сделка и текст с шагом', async () => {
    const userId = await user('c');
    const out = (await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000 }, { userId })) as Out;
    expect(out.message).toMatch(/^Записал сделку: Ахмет — оборудование, 2 млн ₸/);
    expect(await prisma.deal.count({ where: { userId } })).toBe(1);
  });

  it('нит: create_deal с непонятной стадией → переспрос, ничего не создаём', async () => {
    const userId = await user('cstage');
    const out = (await runRegistryTool('create_deal', { personName: 'Ахмет', stage: 'хз какая' }, { userId })) as Out;
    expect(out.message).toMatch(/^Не понял стадию «хз какая»/);
    expect(await prisma.deal.count({ where: { userId } })).toBe(0);
  });

  it('нит: create_deal закрытой стадией — шаг игнорируем', async () => {
    const userId = await user('cclosed');
    const out = (await runRegistryTool('create_deal', { personName: 'Серик', stage: 'проиграна', nextStepDate: '2026-11-10' }, { userId })) as Out;
    expect(out.message).not.toMatch(/Напомню/);
    expect((await prisma.deal.findFirstOrThrow({ where: { userId } })).nextStepAt).toBeNull();
  });

  it('нит: create_deal сразу «выиграна» с суммой → предложение дохода', async () => {
    const userId = await user('cwon');
    const out = (await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'сервис', amount: 300_000, stage: 'оплатил' }, { userId })) as Out;
    expect(out.message).toMatch(/Записать доход .* от Ахмета\?$/);
    expect((await peekPendingAction(userId))?.action).toBe('record_deal_income');
  });

  it('update_deal: две открытые у клиента → переспрос, ничего не меняем', async () => {
    const userId = await user('ask');
    await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'оборудование' }, { userId });
    await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'сервис' }, { userId });
    const out = (await runRegistryTool('update_deal', { personName: 'Ахмет', stage: 'proposal' }, { userId })) as Out;
    expect(out.message).toMatch(/У Ахмета 2 открытые сделки/);
    expect(await prisma.deal.count({ where: { userId, stage: 'proposal' } })).toBe(0);
  });

  it('ревью I6: неточное название единственной сделки → обновляем её, не «нет сделки»', async () => {
    const userId = await user('tie');
    await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'оборудование' }, { userId });
    const out = (await runRegistryTool('update_deal', { personName: 'Ахмет', title: 'оборудования', stage: 'proposal' }, { userId })) as Out;
    expect(out.message).toMatch(/^Сделка Ахмет — оборудование: стадия «КП отправлено»/);
    expect(await prisma.deal.count({ where: { userId } })).toBe(1);
  });

  it('update_deal won с суммой → pending record_deal_income', async () => {
    const userId = await user('won');
    await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'оборудование', amount: 2_000_000 }, { userId });
    const out = (await runRegistryTool('update_deal', { personName: 'Ахмет', stage: 'оплатил' }, { userId })) as Out;
    expect(out.message).toMatch(/Записать доход 2 000 000 ₸ от Ахмета\?/);
    const p = await peekPendingAction(userId);
    expect(p?.action).toBe('record_deal_income');
  });

  it('ревью I5: update_deal без сделки → подсказка агенту (create_task / create_deal), не вопрос юзеру', async () => {
    const userId = await user('none');
    const out = (await runRegistryTool('update_deal', { personName: 'Дана', nextStepDate: '2026-11-10' }, { userId })) as Out & { hint?: string };
    expect(out.message).toBeUndefined();
    expect(out.error).toBe('no_open_deal');
    expect(out.hint).toMatch(/create_task/);
    expect(out.hint).toMatch(/create_deal/);
    expect(await prisma.deal.count({ where: { userId } })).toBe(0);
  });

  it('ревью I3: выиграна без суммы → «сумма 2 млн» → предложение дохода', async () => {
    const userId = await user('wonamt');
    await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'оборудование' }, { userId });
    const a = (await runRegistryTool('update_deal', { personName: 'Ахмет', stage: 'оплатил' }, { userId })) as Out;
    expect(a.message).toContain('Скажи сумму — запишу доход.');
    const b = (await runRegistryTool('update_deal', { personName: 'Ахмет', amount: 2_000_000 }, { userId })) as Out;
    expect(b.message).toMatch(/Записать доход .* от Ахмета\?/);
    expect((await peekPendingAction(userId))?.action).toBe('record_deal_income');
  });

  it('ревью I3: недавно проигранную можно вернуть в работу', async () => {
    const userId = await user('reopen');
    await runRegistryTool('create_deal', { personName: 'Серик', title: 'склад' }, { userId });
    await runRegistryTool('update_deal', { personName: 'Серик', stage: 'отказался' }, { userId });
    const out = (await runRegistryTool('update_deal', { personName: 'Серик', stage: 'переговоры' }, { userId })) as Out;
    expect(out.message).toMatch(/^Сделка Серик — склад: стадия «Переговоры»/);
    expect(await prisma.deal.count({ where: { userId, stage: 'talks' } })).toBe(1);
  });

  it('ревью I3: закрытую не трогаем без суммы/открытой стадии и старше 30 дней', async () => {
    const userId = await user('closed');
    await runRegistryTool('create_deal', { personName: 'Серик', title: 'склад' }, { userId });
    await runRegistryTool('update_deal', { personName: 'Серик', stage: 'отказался' }, { userId });
    const note = (await runRegistryTool('update_deal', { personName: 'Серик', note: 'звонил' }, { userId })) as Out;
    expect(note.error).toBe('no_open_deal');
    await prisma.deal.updateMany({ where: { userId }, data: { closedAt: new Date(Date.now() - 31 * 86_400_000) } });
    const old = (await runRegistryTool('update_deal', { personName: 'Серик', stage: 'переговоры' }, { userId })) as Out;
    expect(old.error).toBe('no_open_deal');
    expect(await prisma.deal.count({ where: { userId, stage: 'lost' } })).toBe(1);
  });

  it('list_deals и set_sales_plan', async () => {
    const userId = await user('list');
    await runRegistryTool('set_sales_plan', { amount: 10_000_000 }, { userId });
    await runRegistryTool('create_deal', { personName: 'Ахмет', title: 'x', amount: 3_000_000 }, { userId });
    const out = (await runRegistryTool('list_deals', {}, { userId })) as Out;
    expect(out.message).toContain('Открыто 1 сделка на 3 млн ₸');
    expect(out.message).toContain('План месяца 10 млн ₸');
  });

  it('нит: set_sales_plan на конкретный месяц', async () => {
    const userId = await user('planm');
    const out = (await runRegistryTool('set_sales_plan', { amount: 10_000_000, month: '2026-12' }, { userId })) as Out;
    expect(out.message).toBe('План продаж на декабрь 2026: 10 млн ₸. Буду считать темп.');
    const row = await prisma.salesPlan.findFirstOrThrow({ where: { userId } });
    expect(row.monthStart.toISOString().slice(0, 10)).toBe('2026-12-01');
  });
});
