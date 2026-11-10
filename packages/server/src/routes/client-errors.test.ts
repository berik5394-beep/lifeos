import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { clientErrorRoutes } from './client-errors.js';
import { resetOpsAlertState, shouldAlertCrash } from '../lib/ops-alert.js';

/** 2026-11-10: сбои приложения у пользователя доходят до нас (раньше — только консоль телефона). */
describe('POST /client-errors', () => {
  beforeEach(() => resetOpsAlertState());
  it('принимает сбой без входа и с входом, пишет в лог', async () => {
    const app = Fastify();
    await app.register(jwt, { secret: 'test-secret-test-secret-test-secret-1' });
    await app.register(clientErrorRoutes);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const anon = await app.inject({ method: 'POST', url: '/client-errors', payload: { message: 'boom', route: 'Finance', fatal: true } });
    expect(anon.statusCode).toBe(204);
    const token = app.jwt.sign({ sub: 'u1' });
    await app.inject({ method: 'POST', url: '/client-errors', headers: { authorization: `Bearer ${token}` }, payload: { message: 'x', stack: 'Error\n    at Foo (a.js:1)' } });
    const lines = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[client-crash]'));
    expect(lines[0]).toContain('user=anon');
    expect(lines[0]).toContain('route=Finance');
    expect(lines[1]).toContain('user=u1');
    expect(lines[1]).toContain('at Foo');
    spy.mockRestore();
    await app.close();
  });
  it('мусор — 400', async () => {
    const app = Fastify();
    await app.register(jwt, { secret: 'test-secret-test-secret-test-secret-1' });
    await app.register(clientErrorRoutes);
    expect((await app.inject({ method: 'POST', url: '/client-errors', payload: { message: 'x'.repeat(600) } })).statusCode).toBe(400);
    await app.close();
  });
  it('новый вид сбоя — пуш сразу, тот же повтор — не чаще раза в час', () => {
    const t = 1_000_000;
    expect(shouldAlertCrash('A', t).send).toBe(true);
    expect(shouldAlertCrash('A', t + 60_000)).toEqual({ send: false, count: 2 });
    expect(shouldAlertCrash('B', t + 60_000).send).toBe(true);
    expect(shouldAlertCrash('A', t + 61 * 60_000).send).toBe(true);
  });
});
