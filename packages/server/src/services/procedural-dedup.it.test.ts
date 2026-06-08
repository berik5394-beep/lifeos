import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function mkUser(email: string) {
  const u = await prisma.user.create({
    data: { email, name: 'PD', passwordHash: 'x', timezone: 'Asia/Almaty' },
  });
  return u.id;
}

// Проверка допущения T2: Prisma JSON path-фильтр находит паттерн по payload-ключу.
describe('Prisma JSON payload path-filter (T2 допущение)', () => {
  it('payload: { path: [entityId], equals } находит СВОЙ паттерн', async () => {
    const u = await mkUser(`pd-json-${Date.now()}@a.test`);
    await prisma.pattern.create({ data: { userId: u, kind: 'frequency', description: 'A', payload: { entityId: 'ent-A', x: 1 }, confidence: 0.7 } });
    await prisma.pattern.create({ data: { userId: u, kind: 'frequency', description: 'B', payload: { entityId: 'ent-B', x: 2 }, confidence: 0.7 } });
    const hitA = await prisma.pattern.findFirst({
      where: { userId: u, kind: 'frequency', invalidAt: null, payload: { path: ['entityId'], equals: 'ent-A' } },
    });
    expect(hitA?.description).toBe('A');
    const hitB = await prisma.pattern.findFirst({
      where: { userId: u, kind: 'frequency', invalidAt: null, payload: { path: ['entityId'], equals: 'ent-B' } },
    });
    expect(hitB?.description).toBe('B');
    const none = await prisma.pattern.findFirst({
      where: { userId: u, kind: 'frequency', invalidAt: null, payload: { path: ['entityId'], equals: 'ent-Z' } },
    });
    expect(none).toBeNull();
  });
  it('AND из двух path-фильтров (entityId+clusterIndex) — для recurring_topic/streak_break', async () => {
    const u = await mkUser(`pd-json2-${Date.now()}@a.test`);
    await prisma.pattern.create({ data: { userId: u, kind: 'recurring_topic', description: 'c0', payload: { entityId: 'e1', clusterIndex: 0 }, confidence: 0.7 } });
    await prisma.pattern.create({ data: { userId: u, kind: 'recurring_topic', description: 'c1', payload: { entityId: 'e1', clusterIndex: 1 }, confidence: 0.7 } });
    const hit = await prisma.pattern.findFirst({
      where: {
        userId: u, kind: 'recurring_topic', invalidAt: null,
        AND: [
          { payload: { path: ['entityId'], equals: 'e1' } },
          { payload: { path: ['clusterIndex'], equals: 1 } },
        ],
      },
    });
    expect(hit?.description).toBe('c1');
  });
});

// Поведенческое доказательство фикса T2 на реальной БД: имитируем upsert
// экстрактора (findFirst → update|create) обоими путями флага.
describe('T2 поведение — дедуп паттернов (имитация upsert frequency)', () => {
  it('ON: повторные прогоны над 2 сущностями НЕ плодят дубликатов', async () => {
    const u = await mkUser(`pd-on-${Date.now()}@a.test`);
    // ON-путь: findFirst фильтрует по entityId (как в проде за флагом).
    const upsert = async (entityId: string) => {
      const existing = await prisma.pattern.findFirst({
        where: {
          userId: u, kind: 'frequency', invalidAt: null,
          payload: { path: ['entityId'], equals: entityId },
        },
      });
      if (existing && (existing.payload as { entityId?: string })?.entityId === entityId) {
        await prisma.pattern.update({ where: { id: existing.id }, data: { observations: { increment: 1 } } });
      } else {
        await prisma.pattern.create({ data: { userId: u, kind: 'frequency', description: 'd', payload: { entityId }, confidence: 0.7 } });
      }
    };
    for (const e of ['ent-A', 'ent-B', 'ent-A', 'ent-B', 'ent-A']) await upsert(e);
    const n = await prisma.pattern.count({ where: { userId: u, kind: 'frequency' } });
    expect(n).toBe(2); // ровно A и B — ни одного дубликата
    const a = await prisma.pattern.findFirst({
      where: { userId: u, kind: 'frequency', payload: { path: ['entityId'], equals: 'ent-A' } },
    });
    expect(a?.observations).toBe(3); // A обновлён (1 → +1 → +1), не пересоздан
  });

  it('OFF (сегодня): findFirst без фильтра возвращает ЧУЖОЙ паттерн → корень дубля', async () => {
    const u = await mkUser(`pd-off-${Date.now()}@a.test`);
    await prisma.pattern.create({ data: { userId: u, kind: 'frequency', description: 'B', payload: { entityId: 'ent-B' }, confidence: 0.7 } });
    // Экстрактор обрабатывает ent-A. OFF-запрос (нынешний код) не фильтрует:
    const offHit = await prisma.pattern.findFirst({ where: { userId: u, kind: 'frequency', invalidAt: null } });
    expect((offHit?.payload as { entityId?: string })?.entityId).toBe('ent-B'); // вернул B → JS-чек (B!==A) мимо → создаст дубль A
    // ON-запрос фильтрует по A → null (паттерна A ещё нет) → корректный single create:
    const onHit = await prisma.pattern.findFirst({
      where: { userId: u, kind: 'frequency', invalidAt: null, payload: { path: ['entityId'], equals: 'ent-A' } },
    });
    expect(onHit).toBeNull();
  });
});
