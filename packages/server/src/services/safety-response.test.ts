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

describe('P1c — вариация на повторный кризис (resources фиксированы)', () => {
  const first = buildSafetyResponse(false);
  const repeat = buildSafetyResponse(true);

  it('repeat ИНАЯ рамка empathy (не copy-paste)', () => {
    expect(repeat).not.toBe(first);
  });

  it('repeat: «Я всё ещё рядом» + «снова написал»', () => {
    expect(repeat).toContain('Я всё ещё рядом');
    expect(repeat).toContain('снова написал');
  });

  it('repeat НЕ содержит first-time-фраз («Мне правда жаль» как открытие)', () => {
    expect(repeat).not.toContain('Мне правда жаль');
  });

  it('repeat closing спрашивает про звонок + про «прямо сейчас»', () => {
    expect(repeat.toLowerCase()).toContain('позвонил');
    expect(repeat.toLowerCase()).toContain('прямо сейчас');
    expect(repeat).not.toMatch(/как ты сейчас\?/i); // другая форма
  });

  it('РЕСУРС-БЛОК идентичен (надёжность 112+«не замена»)', () => {
    expect(repeat).toMatch(/112/);
    expect(repeat.toLowerCase()).toContain('не замена профессиональной');
  });

  it('style-agnostic инвариант СОХРАНЁН (default param → arity 0)', () => {
    expect(buildSafetyResponse.length).toBe(0);
  });
});
