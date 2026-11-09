import { describe, it, expect } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runMemoryDedupeBackfill, backfillLogLine } from './memory-dedupe-backfill.js';
import { restoreMemory } from '../about-me.js';

/** Старые дубли (записаны до двустороннего дедупа) — склейка обратима. */
async function seed() {
  const u = await prisma.user.create({ data: { email: `bf-${Date.now()}-${Math.random()}@t.io`, name: 'Б', passwordHash: 'x' } });
  const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 10, min));
  const mk = (content: string, min: number, extra: Partial<{ type: string; importance: number; tags: string[]; details: string }> = {}) =>
    prisma.memory.create({
      data: { userId: u.id, type: extra.type ?? 'fact', content, importance: extra.importance ?? 5, tags: extra.tags ?? [], details: extra.details ?? null, source: 'v2-episodic', createdAt: at(min) },
    });
  const coffee = await mk('Любит кофе', 1, { tags: ['еда'] });
  const coffee2 = await mk('Очень любит кофе по утрам', 2, { importance: 8, tags: ['утро'] });
  const serik = await mk('Серик', 3);
  const serik2 = await mk('серик.', 4);
  const debt = await mk('Серик должен мне 20 000 до пятницы', 5);
  const almaty = await mk('Живёт в Алматы', 6);
  const astana = await mk('Живёт в Астане', 7);
  const prefCoffee = await mk('Любит кофе', 8, { type: 'preference' });
  return { userId: u.id, coffee, coffee2, serik, serik2, debt, almaty, astana, prefCoffee };
}
const alive = (userId: string) =>
  prisma.memory.findMany({ where: { userId, invalidAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, content: true, importance: true, tags: true } });

describe('разовая склейка старых дублей памяти', () => {
  it('dry — только считает, ничего не меняет', async () => {
    const s = await seed();
    const before = await alive(s.userId);
    const r = await runMemoryDedupeBackfill('dry');
    const mine = r.pairs.filter((p) => p.userId === s.userId);
    expect(mine).toEqual([
      { userId: s.userId, type: 'fact', from: s.coffee2.id, into: s.coffee.id },
      { userId: s.userId, type: 'fact', from: s.serik2.id, into: s.serik.id },
    ]);
    expect(await alive(s.userId)).toEqual(before);
    expect(backfillLogLine(r)).toMatch(/^\[memory-dedupe\] mode=dry users=\d+ scanned=\d+ merged=\d+/);
  });

  it('apply — дубль «забыт», выжившая старшая получила подробную формулировку, теги и важность; можно вернуть', async () => {
    const s = await seed();
    await runMemoryDedupeBackfill('apply');
    const rows = await alive(s.userId);
    expect(rows.map((r) => r.id)).toEqual([s.coffee.id, s.serik.id, s.debt.id, s.almaty.id, s.astana.id, s.prefCoffee.id]);
    const coffee = rows.find((r) => r.id === s.coffee.id)!;
    expect(coffee.content).toBe('Очень любит кофе по утрам');
    expect(coffee.importance).toBe(8);
    expect(coffee.tags.sort()).toEqual(['еда', 'утро']);
    // Обратимо — как «Вернуть» после «Неправда».
    expect(await restoreMemory(s.userId, s.coffee2.id)).toBe(true);
    // Повторный прогон после apply ничего нового (кроме возвращённой) не находит у других.
    const again = await runMemoryDedupeBackfill('dry');
    expect(again.pairs.filter((p) => p.userId === s.userId).map((p) => p.from)).toEqual([s.coffee2.id]);
  });
});
