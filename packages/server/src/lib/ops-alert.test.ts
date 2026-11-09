import { describe, it, expect, beforeEach } from 'vitest';
import { classifyFailure, shouldAlert, alertText, resetOpsAlertState } from './ops-alert.js';

describe('classifyFailure — что сломалось', () => {
  it('ключ не принят', () => {
    expect(classifyFailure(401, '{"error":{"type":"authentication_error"}}')).toBe('auth');
    expect(classifyFailure(403, '')).toBe('auth');
  });
  it('кончился баланс Anthropic (400 с текстом о балансе) — как было 2026-11-09', () => {
    expect(
      classifyFailure(400, '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'),
    ).toBe('billing');
  });
  it('лимит, перегруз, сеть', () => {
    expect(classifyFailure(429, '')).toBe('rate');
    expect(classifyFailure(529, 'overloaded_error')).toBe('overloaded');
    expect(classifyFailure(599, 'fetch failed')).toBe('overloaded');
  });
  it('наш кривой запрос (400) — не будим, это баг кода в логах', () => {
    expect(classifyFailure(400, 'messages.0: user messages must have non-empty content')).toBe('other');
    expect(alertText('claude', 'other', 1)).toBeNull();
  });
});

describe('shouldAlert — не спамить', () => {
  beforeEach(() => resetOpsAlertState());
  const t0 = 1_800_000_000_000;

  it('ключ/баланс — сразу, потом не чаще раза в час', () => {
    expect(shouldAlert('claude', 'billing', t0).send).toBe(true);
    expect(shouldAlert('claude', 'billing', t0 + 5 * 60_000).send).toBe(false);
    expect(shouldAlert('claude', 'billing', t0 + 61 * 60_000).send).toBe(true);
  });
  it('разные провайдеры и виды — независимо', () => {
    expect(shouldAlert('claude', 'auth', t0).send).toBe(true);
    expect(shouldAlert('groq', 'auth', t0).send).toBe(true);
    expect(shouldAlert('claude', 'billing', t0).send).toBe(true);
  });
  it('перегруз — только пачкой (5 за 10 минут)', () => {
    for (let i = 0; i < 4; i++) expect(shouldAlert('claude', 'overloaded', t0 + i * 1000).send).toBe(false);
    const fifth = shouldAlert('claude', 'overloaded', t0 + 5000);
    expect(fifth).toEqual({ send: true, count: 5 });
  });
  it('редкие сбои, разнесённые больше чем на 10 минут, не копятся', () => {
    for (let i = 0; i < 6; i++) expect(shouldAlert('claude', 'rate', t0 + i * 11 * 60_000).send).toBe(false);
  });
});

describe('alertText — по-русски и с действием', () => {
  it('баланс Claude → куда идти', () => {
    const t = alertText('claude', 'billing', 1)!;
    expect(t.title).toContain('баланс');
    expect(t.body).toContain('console.anthropic.com');
  });
  it('ключ Groq → какую переменную менять', () => {
    expect(alertText('groq', 'auth', 1)!.body).toContain('GROQ_API_KEY');
  });
});
