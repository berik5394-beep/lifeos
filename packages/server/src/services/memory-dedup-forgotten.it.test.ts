import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { writeMemory } from './episodic-memory.js';
import { forgetMemory } from './about-me.js';
import { getRelevantMemories } from './memory-service.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
async function mkUser(email: string) {
  const u = await prisma.user.create({ data: { email, name: 'DD', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}

// «Неправда» на экране «Что я о тебе помню» ставит invalidAt. Если потом
// человек скажет похожее снова, дедуп не должен сливать новую запись в
// забытую — иначе новое знание тоже останется невидимым.
describe('writeMemory — дедуп не сливает в забытую запись', () => {
  it('после «Неправда» похожий факт создаётся новой видимой записью', async () => {
    const u = await mkUser(`dd-forgot-${Date.now()}@a.test`);
    const r1 = await writeMemory(u, { type: 'fact', content: 'мама живёт в Алматы', importance: 6, source: 'chat' });
    expect(r1.action).toBe('created');
    await forgetMemory(u, r1.id);

    const r2 = await writeMemory(u, { type: 'fact', content: 'мама живёт в Алматы', importance: 6, source: 'chat' });
    expect(r2.action).toBe('created');
    expect(r2.id).not.toBe(r1.id);

    const fresh = await prisma.memory.findUnique({ where: { id: r2.id }, select: { invalidAt: true } });
    expect(fresh?.invalidAt).toBeNull();
    const old = await prisma.memory.findUnique({ where: { id: r1.id }, select: { invalidAt: true } });
    expect(old?.invalidAt).not.toBeNull();
  });

  // Флейк 2026-11-08 (≈1 из 10 прогонов): «забыто» ставится часами ПРИЛОЖЕНИЯ,
  // а дедуп сравнивал с NOW() БАЗЫ. База отставала на ~1 мс → только что
  // забытая запись считалась живой, новый факт сливался в неё и пропадал.
  // Здесь расхождение растянуто до часа (часы приложения впереди) — без
  // фикса тест падает КАЖДЫЙ раз.
  describe('часы приложения и базы расходятся', () => {
    afterEach(() => vi.useRealTimers());
    it('приложение спешит на час — забытое всё равно не цель дедупа', async () => {
      const u = await mkUser(`dd-skew-${Date.now()}@a.test`);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + 3_600_000));
      const r1 = await writeMemory(u, { type: 'fact', content: 'сестра живёт в Астане', importance: 6, source: 'chat' });
      expect(r1.action).toBe('created');
      expect(await forgetMemory(u, r1.id)).toBe(true);
      const r2 = await writeMemory(u, { type: 'fact', content: 'сестра живёт в Астане', importance: 6, source: 'chat' });
      expect(r2.action).toBe('created');
      expect(r2.id).not.toBe(r1.id);
    });

    it('приложение спешит на час — забытое не всплывает в поиске воспоминаний', async () => {
      const u = await mkUser(`dd-skew-recall-${Date.now()}@a.test`);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + 3_600_000));
      const r1 = await writeMemory(u, { type: 'fact', content: 'дядя держит пасеку', importance: 6, source: 'chat' });
      await forgetMemory(u, r1.id);
      const rows = await getRelevantMemories(u, 'пасека', 20);
      expect(rows.map((r) => r.content)).not.toContain('дядя держит пасеку');
    });
  });

  it('живая запись по-прежнему дедупится (обновление, не дубль)', async () => {
    const u = await mkUser(`dd-live-${Date.now()}@a.test`);
    const r1 = await writeMemory(u, { type: 'fact', content: 'брат работает врачом', importance: 6, source: 'chat' });
    const r2 = await writeMemory(u, { type: 'fact', content: 'брат работает врачом', importance: 7, source: 'chat' });
    expect(r2.action).toBe('updated');
    expect(r2.id).toBe(r1.id);
  });
});
