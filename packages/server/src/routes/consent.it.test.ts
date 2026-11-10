import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { authRoutes } from './auth.js';
import { CONSENT_VERSION } from '../legal/legal-text.js';

/** App Store 2026-11-10: согласие (16+, условия, сторонний ИИ) в БД + токсичный стиль только с согласием. */
const prisma = new PrismaClient();
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp([authRoutes]);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
const user = async (data: Record<string, unknown> = {}) => {
  const u = await prisma.user.create({
    data: { email: `consent-${Date.now()}-${Math.random()}@a.test`, name: 'A', passwordHash: 'x', ...data },
  });
  return { id: u.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: u.id })}` } };
};
const me = async (headers: Record<string, string>) =>
  (await app.inject({ method: 'GET', url: '/auth/me', headers })).json();

describe('согласие', () => {
  it('без согласия — /auth/me просит его; дал — больше не просит, время и версия в БД', async () => {
    const u = await user();
    const before = await me(u.headers);
    expect(before.user.consentRequired).toBe(true);
    expect(before.consentVersion).toBe(CONSENT_VERSION);
    const r = await app.inject({ method: 'POST', url: '/auth/consent', headers: u.headers, payload: { ageConfirmed: true, version: CONSENT_VERSION } });
    expect(r.statusCode).toBe(200);
    expect((await me(u.headers)).user.consentRequired).toBe(false);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.consentVersion).toBe(CONSENT_VERSION);
    expect(row.consentAt).toBeInstanceOf(Date);
  });
  it('без подтверждения возраста — нельзя; устаревшая версия — 409', async () => {
    const u = await user();
    expect((await app.inject({ method: 'POST', url: '/auth/consent', headers: u.headers, payload: { ageConfirmed: false, version: CONSENT_VERSION } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/auth/consent', headers: u.headers, payload: { ageConfirmed: true, version: '2020-01-01' } })).statusCode).toBe(409);
  });
  it('старое согласие (политика обновилась) — спросит снова', async () => {
    const u = await user({ consentAt: new Date(), consentVersion: '2026-01-01' });
    expect((await me(u.headers)).user.consentRequired).toBe(true);
  });
  it('регистрация с галочкой — согласие сохранено сразу', async () => {
    const email = `reg-${Date.now()}@a.test`;
    const r = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, name: 'Берик', password: 'Zx9!long-pass', consent: true } });
    expect(r.statusCode).toBeLessThan(300);
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.consentVersion).toBe(CONSENT_VERSION);
  });
});

describe('токсичный стиль — только с согласием', () => {
  it('прямой PATCH без подтверждения — 400, стиль не меняется', async () => {
    const u = await user();
    const r = await app.inject({ method: 'PATCH', url: '/auth/profile', headers: u.headers, payload: { assistantStyle: 'toxic' } });
    expect(r.statusCode).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).assistantStyle).toBe('friendly');
  });
  it('с подтверждением — включается и согласие запоминается; потом можно без флага', async () => {
    const u = await user();
    const r = await app.inject({ method: 'PATCH', url: '/auth/profile', headers: u.headers, payload: { assistantStyle: 'toxic', toxicConsent: true } });
    expect(r.statusCode).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.assistantStyle).toBe('toxic');
    expect(row.toxicConsentAt).toBeInstanceOf(Date);
    await app.inject({ method: 'PATCH', url: '/auth/profile', headers: u.headers, payload: { assistantStyle: 'calm' } });
    expect((await app.inject({ method: 'PATCH', url: '/auth/profile', headers: u.headers, payload: { assistantStyle: 'toxic' } })).statusCode).toBe(200);
  });
});
