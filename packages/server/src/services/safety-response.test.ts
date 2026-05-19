import { describe, it, expect } from 'vitest';
import { buildSafetyResponse } from './safety-response.js';

/**
 * Phase 6 C1 — инварианты хардкод safety-ответа. Главный:
 * style-agnostic BY CONSTRUCTION (arity 0 — стиль НЕЛЬЗЯ передать).
 */

describe('buildSafetyResponse — структурные инварианты', () => {
  const r = buildSafetyResponse();

  it('style-agnostic by construction: функция без аргументов', () => {
    expect(buildSafetyResponse.length).toBe(0);
  });

  it('детерминирован (два вызова идентичны)', () => {
    expect(buildSafetyResponse()).toBe(r);
  });

  it('валидация без диагноза + «ты не один»', () => {
    expect(r.toLowerCase()).toContain('жаль');
    expect(r.toLowerCase()).toContain('не один');
  });

  it('содержит экстренный ресурс (112) и «не замена профессиональной»', () => {
    expect(r).toMatch(/112/);
    expect(r.toLowerCase()).toContain('не замена профессиональной');
  });

  it('предлагает найти специалиста + открытый вопрос (не указание)', () => {
    expect(r.toLowerCase()).toContain('найти специалиста');
    expect(r).toMatch(/как ты сейчас\?/i);
  });

  it('никаких директив/диагнозов («ты должен», «у тебя депрессия»)', () => {
    expect(r.toLowerCase()).not.toContain('ты должен');
    expect(r.toLowerCase()).not.toContain('у тебя депресс');
    expect(r.toLowerCase()).not.toContain('диагно');
  });
});
