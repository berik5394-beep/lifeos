import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { authRoutes } from './auth.js';

const prisma = new PrismaClient();
const app = await buildTestApp([authRoutes]);
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const reg = (email: string) =>
  app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, name: 'Test', password: 'Str0ng!Passw0rd' },
  });

describe('auth поведенчески', () => {
  it('register → 201 + токены', async () => {
    const r = await reg('reg@a.test');
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b.accessToken).toBeTruthy();
    expect(b.refreshToken).toBeTruthy();
  });

  it('login верным паролем → 200; неверным → 401', async () => {
    await reg('login@a.test');
    const ok = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'login@a.test', password: 'Str0ng!Passw0rd' },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'login@a.test', password: 'wrong' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('refresh ротирует, а повторный СТАРЫЙ refresh → 401 + все токены отозваны', async () => {
    const r0 = (await reg('rot@a.test')).json();
    const rot = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: r0.refreshToken },
    });
    expect(rot.statusCode).toBe(200);
    const r1 = rot.json();
    expect(r1.refreshToken).toBeTruthy();
    expect(r1.refreshToken).not.toBe(r0.refreshToken);

    // reuse старого → 401
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: r0.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);

    // reuse-detection отозвал ВСЕ → новый r1 тоже больше не работает
    const after = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: r1.refreshToken },
    });
    expect(after.statusCode).toBe(401);
  });

  it('delete-account удаляет юзера С CorrectionLog/SkillDefinition без FK-падения (Fix #4)', async () => {
    // Создаём юзера НАПРЯМУЮ (не через /register) — обойти registerLimiter
    // (max:3/мин на IP; в тестах все inject с одного IP). Токен подписываем сами
    // тем же jwt-плагином, что регистрирует buildTestApp.
    const user = await prisma.user.create({
      data: {
        email: 'del@a.test',
        name: 'Del',
        passwordHash: await bcrypt.hash('Str0ng!Passw0rd', 12),
      },
    });
    const accessToken = app.jwt.sign({ sub: user.id });
    // Создаём именно те модели, что Fix #4 добавил в каскад (реальные поля схемы).
    await prisma.correctionLog.create({
      data: {
        userId: user.id,
        botExcerpt: 'b',
        userExcerpt: 'u',
        signalType: 'explicit',
        valence: 'negative',
        dimension: 'tone',
        appliedSignals: [],
      },
    });
    await prisma.skillDefinition.create({
      data: {
        userId: user.id,
        name: 'tskill',
        description: 'd',
        triggers: ['x'],
        plan: [],
        synthesis: 's',
        source: 'explicit',
      },
    });

    const del = await app.inject({
      method: 'POST',
      url: '/auth/delete-account',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: 'Str0ng!Passw0rd' },
    });
    expect(del.statusCode).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.correctionLog.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.skillDefinition.count({ where: { userId: user.id } })).toBe(0);
  });
  it('delete-account стирает и таблицы без FK (ToolCall/PendingAction/AiUsageDaily/CronJobRun) — нет сирот с ПД', async () => {
    const user = await prisma.user.create({
      data: { email: 'del-orph@a.test', name: 'Del', passwordHash: await bcrypt.hash('Str0ng!Passw0rd', 12) },
    });
    const other = await prisma.user.create({
      data: { email: 'keep-orph@a.test', name: 'Keep', passwordHash: 'x' },
    });
    const accessToken = app.jwt.sign({ sub: user.id });
    for (const uid of [user.id, other.id]) {
      await prisma.toolCall.create({
        data: { userId: uid, toolName: 'add_expense', inputJson: { amount: 5000, description: 'аптека' }, durationMs: 1 },
      });
      await prisma.pendingAction.create({
        data: { userId: uid, action: 'add_expense', inputJson: { amount: 1 }, confirmationText: 'да?' },
      });
      await prisma.aiUsageDaily.create({ data: { userId: uid, day: new Date('2026-11-05T00:00:00Z'), count: 3 } });
      await prisma.cronJobRun.create({ data: { jobName: 'morning', userId: uid } });
    }

    const del = await app.inject({
      method: 'POST',
      url: '/auth/delete-account',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: 'Str0ng!Passw0rd' },
    });
    expect(del.statusCode).toBe(200);
    for (const [uid, n] of [[user.id, 0], [other.id, 1]] as const) {
      expect(await prisma.toolCall.count({ where: { userId: uid } })).toBe(n);
      expect(await prisma.pendingAction.count({ where: { userId: uid } })).toBe(n);
      expect(await prisma.aiUsageDaily.count({ where: { userId: uid } })).toBe(n);
      expect(await prisma.cronJobRun.count({ where: { userId: uid } })).toBe(n);
    }
  });
});
