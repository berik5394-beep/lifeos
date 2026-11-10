import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
// Реестр первым — как в приложении (у модулей инструментов есть цикл импортов).
import './index.js';
import { recallPersonTool } from './recall-person.js';
import { completeTaskTool } from './complete-task.js';
import { cancelTaskTool } from './cancel-task.js';
import { moveTaskTool } from './move-task.js';
import { createObligation, listObligations } from '../services/obligations/postgres-impl.js';

/**
 * Поиск «по кусочкам букв» по всей системе (2026-11-10): голос исказил имя или
 * название — робот находит похожее, но ПЕРЕСПРАШИВАЕТ, а не действует молча.
 */
const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });
const user = async () =>
  (await prisma.user.create({ data: { email: `fzn-${Date.now()}-${Math.random()}@a.test`, name: 'F', passwordHash: 'x' } })).id;
const day = new Date('2026-11-10T00:00:00Z');

describe('люди', () => {
  it('recall_person: «Сирик» → контакт и человек «Серик», с пометкой «переспроси»', async () => {
    const userId = await user();
    await prisma.contactCache.create({ data: { userId, phoneId: 'c1', name: 'Серик Ахметов', phone: '+77010000000' } });
    await prisma.entity.create({ data: { userId, type: 'person', name: 'Серик' } });
    const r = (await recallPersonTool.handler({ name: 'Сирик' }, { userId })) as {
      contacts: Array<{ name: string }>; people: Array<{ name: string }>; approximate?: boolean; note?: string;
    };
    expect(r.contacts[0]?.name).toBe('Серик Ахметов');
    expect(r.people[0]?.name).toBe('Серик');
    expect(r.approximate).toBe(true);
    expect(r.note).toMatch(/Переспроси/);
  });
  it('recall_person: точное имя — без пометки; чужое имя — пусто', async () => {
    const userId = await user();
    await prisma.contactCache.create({ data: { userId, phoneId: 'c2', name: 'Айгерим', phone: '+77010000001' } });
    const exact = (await recallPersonTool.handler({ name: 'Айгерим' }, { userId })) as { approximate?: boolean; contacts: unknown[] };
    expect(exact.contacts).toHaveLength(1);
    expect(exact.approximate).toBeUndefined();
    const none = (await recallPersonTool.handler({ name: 'Азамат' }, { userId })) as { approximate?: boolean; contacts: unknown[] };
    expect(none.contacts).toHaveLength(0);
    expect(none.approximate).toBeUndefined();
  });
  it('долги: «что я должен Сирику» находит долг Серику', async () => {
    const userId = await user();
    await createObligation({ userId, personName: 'Серик', direction: 'i_owe', kind: 'money', amount: 20000, description: 'за ужин', source: 'manual' });
    const rows = await listObligations(userId, { personName: 'Сирику' });
    expect(rows.map((r) => r.personName)).toEqual(['Серик']);
  });
});

describe('задачи: опечатка в названии — переспросить, не закрывать наугад', () => {
  it('complete / move / cancel', async () => {
    const userId = await user();
    const t = await prisma.task.create({ data: { userId, title: 'Подготовить отчёт для банка', category: 'work', priority: 'high', date: day } });
    await prisma.task.create({ data: { userId, title: 'Позвонить маме', category: 'personal', priority: 'low', date: day } });
    const c = (await completeTaskTool.handler({ title: 'подготовить отчот' }, { userId })) as { ambiguous?: boolean; message: string; candidates?: Array<{ taskId: string }> };
    expect(c.ambiguous).toBe(true);
    expect(c.message).toMatch(/Ты про «Подготовить отчёт для банка»/);
    expect(c.candidates?.[0]?.taskId).toBe(t.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).completed).toBe(false);
    const m = (await moveTaskTool.handler({ title: 'подготовить отчот', newDate: '2026-11-12' }, { userId })) as { message: string };
    expect(m.message).toMatch(/Ты про/);
    const x = (await cancelTaskTool.handler({ title: 'подготовить отчот' }, { userId })) as { ambiguous?: boolean };
    expect(x.ambiguous).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).cancelled).toBe(false);
    const none = (await completeTaskTool.handler({ title: 'пароль от вайфая' }, { userId })) as { notFound?: boolean };
    expect(none.notFound).toBe(true);
  });
});
