import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { writeMemory } from './episodic-memory.js';

/**
 * Живой путь writeMemory на настоящем русском FTS: уточнение факта не плодит
 * дубль, разные факты не сливаются (2026-11-09).
 */
async function user() {
  return (await prisma.user.create({ data: { email: `dd-${Date.now()}-${Math.random()}@t.io`, name: 'Д', passwordHash: 'x' } })).id;
}
const rows = (userId: string) => prisma.memory.findMany({ where: { userId, type: 'fact' }, select: { content: true } });

describe('дедуп памяти в обе стороны (БД)', () => {
  it('точный повтор одного слова — одна запись', async () => {
    const u = await user();
    await writeMemory(u, { type: 'fact', content: 'Серик' });
    const r = await writeMemory(u, { type: 'fact', content: 'серик.' });
    expect(r.action).toBe('updated');
    expect(await rows(u)).toHaveLength(1);
  });

  it('уточнение факта обновляет запись, а не плодит вторую', async () => {
    const u = await user();
    await writeMemory(u, { type: 'fact', content: 'Любит кофе' });
    const r = await writeMemory(u, { type: 'fact', content: 'Очень любит кофе по утрам' });
    expect(r.action).toBe('updated');
    expect(await rows(u)).toHaveLength(1);

    await writeMemory(u, { type: 'fact', content: 'Мама — Айгуль' });
    expect((await writeMemory(u, { type: 'fact', content: 'Маму зовут Айгуль' })).action).toBe('updated');
    expect(await rows(u)).toHaveLength(2);
  });

  it('разные факты не сливаются: короткое имя ≠ факт про него; другой город — отдельно', async () => {
    const u = await user();
    await writeMemory(u, { type: 'fact', content: 'Серик' });
    expect((await writeMemory(u, { type: 'fact', content: 'Серик должен мне 20 000 до пятницы' })).action).toBe('created');
    await writeMemory(u, { type: 'fact', content: 'Живёт в Алматы' });
    expect((await writeMemory(u, { type: 'fact', content: 'Живёт в Астане' })).action).toBe('created');
    expect(await rows(u)).toHaveLength(4);
  });

  it('другой тип не трогаем (предпочтение ≠ факт)', async () => {
    const u = await user();
    await writeMemory(u, { type: 'fact', content: 'Любит кофе' });
    expect((await writeMemory(u, { type: 'preference', content: 'Любит кофе' })).action).toBe('created');
  });
});
