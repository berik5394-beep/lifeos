import { describe, it, expect, afterAll, beforeAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { authRoutes } from '../routes/auth.js';
import { requestPasswordReset, resetPassword, RESET_MAX_ATTEMPTS } from './password-reset.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => { app = await buildTestApp([authRoutes]); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function mkUser(password = 'oldpass123') {
  const email = `pr-${Date.now()}-${Math.random().toString(36).slice(2)}@a.test`;
  const u = await prisma.user.create({ data: { email, name: 'Лейла Ахметова', passwordHash: await bcrypt.hash(password, 4) } });
  return { id: u.id, email };
}

describe('«Забыли пароль?»: код → новый пароль', () => {
  it('верный код меняет пароль, закрывает старые сессии; вход — новым паролем', async () => {
    const u = await mkUser();
    await prisma.refreshToken.create({ data: { userId: u.id, tokenHash: `h-${u.id}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    await requestPasswordReset(u.email.toUpperCase(), { genCode: () => '123456' });
    await resetPassword(u.email, '123456', 'newpass456');

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email, password: 'newpass456' } });
    expect(login.statusCode).toBe(200);
    const old = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email, password: 'oldpass123' } });
    expect(old.statusCode).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: u.id, tokenHash: `h-${u.id}`, revoked: false } })).toBe(0);
    // код одноразовый
    await expect(resetPassword(u.email, '123456', 'another789')).rejects.toThrow(/устаревший/);
  });

  it('неверный код: попытки считаются, после 5-й — только новый код', async () => {
    const u = await mkUser();
    await requestPasswordReset(u.email, { genCode: () => '111111' });
    await expect(resetPassword(u.email, '000000', 'newpass456')).rejects.toThrow(`Осталось попыток: ${RESET_MAX_ATTEMPTS - 1}`);
    for (let i = 1; i < RESET_MAX_ATTEMPTS; i++) await resetPassword(u.email, '000000', 'newpass456').catch(() => null);
    await expect(resetPassword(u.email, '111111', 'newpass456')).rejects.toThrow(/Слишком много попыток/);
  });

  it('новый запрос гасит старый код; чаще раза в минуту — не шлём', async () => {
    const u = await mkUser();
    const t0 = new Date();
    await requestPasswordReset(u.email, { genCode: () => '222222', now: t0 });
    const again = await requestPasswordReset(u.email, { genCode: () => '333333', now: new Date(t0.getTime() + 10_000) });
    expect(again).toEqual({ email: false, telegram: false });
    await requestPasswordReset(u.email, { genCode: () => '444444', now: new Date(t0.getTime() + 61_000) });
    await expect(resetPassword(u.email, '222222', 'newpass456', new Date(t0.getTime() + 62_000))).rejects.toThrow();
    await resetPassword(u.email, '444444', 'newpass456', new Date(t0.getTime() + 62_000));
  });

  it('код живёт 15 минут', async () => {
    const u = await mkUser();
    const t0 = new Date();
    await requestPasswordReset(u.email, { genCode: () => '555555', now: t0 });
    await expect(resetPassword(u.email, '555555', 'newpass456', new Date(t0.getTime() + 16 * 60_000))).rejects.toThrow(/устаревший/);
  });

  it('письмо уходит через Resend, когда настроено', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('MAIL_FROM', 'LifeOS <no-reply@example.com>');
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      return new Response('{"id":"x"}', { status: 200 });
    }));
    const u = await mkUser();
    const res = await requestPasswordReset(u.email, { genCode: () => '777777' });
    expect(res.email).toBe(true);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(calls[0].body) as { to: string[]; text: string };
    expect(body.to).toEqual([u.email]);
    expect(body.text).toContain('777777');
    expect(body.text).toMatch(/^Лейла, /);
  });

  it('маршруты: ответ на запрос одинаковый для чужой почты; кривой код — 400', async () => {
    const unknown = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'nobody-here@a.test' } });
    expect(unknown.statusCode).toBe(200);
    const u = await mkUser();
    const known = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: u.email } });
    expect(known.json()).toEqual(unknown.json());
    const bad = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { email: u.email, code: '12ab', newPassword: 'newpass456' } });
    expect(bad.statusCode).toBe(400);
    const weak = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { email: u.email, code: '000000', newPassword: 'abcdefgh' } });
    expect(weak.statusCode).toBe(400);
  });
});
