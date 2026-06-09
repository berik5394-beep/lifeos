import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { writeMemory, significantMemories } from './episodic-memory.js';

// Pattern from forget-triad.it.test.ts: own PrismaClient, disconnect in afterAll.
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

// Each it-block starts with a clean DB (setup.ts → beforeEach → resetDb truncates all).
// Therefore every test creates its own user with a unique e-mail via mkUser().

async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({
    data: { email: `it-memtier2-${tag}@it.local`, name: 'IT', passwordHash: 'x', timezone: 'Asia/Almaty' },
  });
  return u.id;
}

// ---------------------------------------------------------------------------
// T5 — sparse-guard: богатый details НЕ затирается бедным повтором
// ---------------------------------------------------------------------------

describe('T5 — details не затирается бедным повтором', () => {
  it('богатый details сохраняется при sparse-повторе (mergeDetails в writeMemory)', async () => {
    process.env.FEATURE_V2_MEM_QUALITY = 'all';

    const uid = await mkUser(`t5-${Date.now()}`);
    const rich = 'Серик Жумабаев — брат, познакомились в школе в 2005';

    // Первый вызов: богатый details
    await writeMemory(uid, { type: 'person', content: 'Серик', details: rich, importance: 7 });
    // Второй вызов: sparse details (короче rich → не должен затереть)
    await writeMemory(uid, { type: 'person', content: 'Серик', details: 'Серик', importance: 5 });

    const rows = await prisma.memory.findMany({ where: { userId: uid, type: 'person' } });
    expect(rows).toHaveLength(1); // дедуп STABLE_TYPES: одна строка
    expect(rows[0].details).toBe(rich); // бедный details НЕ затёр богатый
  });
});

// ---------------------------------------------------------------------------
// E2 — significantMemories поднимает важное старое выше пустяков
// ---------------------------------------------------------------------------

describe('E2 — significantMemories поднимает важное старое', () => {
  it('важная старая запись попадает в топ над свежими пустяками', async () => {
    const uid = await mkUser(`e2-${Date.now()}`);
    const old = new Date(Date.now() - 12 * 86_400_000);

    // Важная старая запись (importance 9, 12 дней назад)
    await prisma.memory.create({
      data: {
        userId: uid,
        type: 'fact',
        content: 'ВАЖНОЕ-СТАРОЕ',
        importance: 9,
        source: 'v2-episodic',
        createdAt: old,
      },
    });

    // 6 свежих пустяков (importance 3)
    for (let i = 0; i < 6; i++) {
      await prisma.memory.create({
        data: {
          userId: uid,
          type: 'fact',
          content: `пустяк-${i}`,
          importance: 3,
          source: 'v2-episodic',
        },
      });
    }

    const out = await significantMemories(uid, 6);
    expect(out.map((r) => r.content)).toContain('ВАЖНОЕ-СТАРОЕ');
  });
});

// ---------------------------------------------------------------------------
// cross-user — изоляция: чужая память не видна
// ---------------------------------------------------------------------------

describe('cross-user — чужая память не видна', () => {
  it('significantMemories не возвращает чужие записи', async () => {
    // Создаём пользователя-владельца с данными
    const uid = await mkUser(`owner-${Date.now()}`);
    await prisma.memory.create({
      data: {
        userId: uid,
        type: 'fact',
        content: 'ВАЖНОЕ-СТАРОЕ',
        importance: 9,
        source: 'v2-episodic',
      },
    });

    // Запрашиваем от имени другого пользователя (не существует в БД)
    const out = await significantMemories('someone-else-xyz', 6);
    expect(out.every((r) => r.content !== 'ВАЖНОЕ-СТАРОЕ')).toBe(true);
  });
});
