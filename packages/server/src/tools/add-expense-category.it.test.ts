import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { addExpenseTool } from './add-expense.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
async function seedUser(tag: string) {
  return (await prisma.user.create({ data: { email: `aec-${tag}-${Date.now()}@a.test`, name: 'B', passwordHash: 'x', timezone: 'Asia/Almaty' } })).id;
}
const run = (userId: string, input: Record<string, unknown>) => addExpenseTool.handler(input as never, { userId } as never);

// Голос: «потратил 3000» → «на что?» → «еда». Раньше в БД ложилось «еда»,
// и финансовый график (food/transport/…) такой расход не видел.
describe('add_expense: категория ложится ключом графика', () => {
  it('«еда» → food', async () => {
    const u = await seedUser('food');
    await run(u, { amount: 3000, category: 'еда' });
    const e = await prisma.expense.findFirst({ where: { userId: u } });
    expect(e?.category).toBe('food');
  });
  it('«компьютер» → other, слово сохранено в описании', async () => {
    const u = await seedUser('pc');
    await run(u, { amount: 100000, category: 'компьютер' });
    const e = await prisma.expense.findFirst({ where: { userId: u } });
    expect(e?.category).toBe('other');
    expect(e?.description).toBe('компьютер');
  });
  it('своё описание не затирается', async () => {
    const u = await seedUser('desc');
    await run(u, { amount: 5000, category: 'transport', description: 'заправка' });
    const e = await prisma.expense.findFirst({ where: { userId: u } });
    expect(e).toMatchObject({ category: 'transport', description: 'заправка' });
  });
});
