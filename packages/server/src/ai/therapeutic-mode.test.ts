import { describe, it, expect } from 'vitest';
import { THERAPEUTIC_STYLE_BLOCK } from './therapeutic-mode.js';

/**
 * Phase 6 C3.2 — инварианты prompt-блока. Live-поведение LLM
 * проверяется на C6 e2e smoke (10 эмо-диалогов); здесь — PROMPT
 * содержит инструкции на 5 паттернов и явные запреты (если кто-то
 * выкинет запрет — тест красный).
 */

describe('THERAPEUTIC_STYLE_BLOCK — инструкции и запреты', () => {
  const T = THERAPEUTIC_STYLE_BLOCK.toLowerCase();

  it('содержит все 5 обязательных паттернов', () => {
    expect(T).toContain('отражение чувств');
    expect(T).toContain('открытые вопросы');
    expect(T).toContain('валидация');
    expect(T).toContain('conditional advice');
    expect(T).toContain('memory recall');
  });

  it('приоритет: слушать > спрашивать > предлагать > советовать', () => {
    expect(T).toMatch(
      /слушать\s*>\s*спрашивать\s*>\s*предлагать\s*>\s*советовать/,
    );
  });

  it('явные запреты: self-label психолог/терапевт, диагнозы, директивы', () => {
    expect(T).toContain('строго запрещено');
    expect(T).toMatch(/называть\s+себя\s+психологом\/терапевтом/);
    expect(T).toMatch(/ставить\s+диагнозы/);
    expect(T).toMatch(/директивы\s+«ты\s+должен»/);
    expect(T).toMatch(/советы\s+без\s+приглашения/);
  });

  it('явно перебивает стиль (toxic/strict/...) для эмо-хода', () => {
    expect(T).toMatch(/стиль\s+\(toxic\/strict\/friendly\/calm\)\s+игнорируется/);
  });

  it('запрещает markdown/эмодзи (форма как в основном промпте)', () => {
    expect(T).toMatch(/без\s+эмодзи\s+и\s+markdown/);
  });

  // ----- P1a: ANTI-КАТАСТРОФИЗАЦИЯ (Berik P1, нисходящая спираль) -----
  it('содержит блок АНТИ-КАТАСТРОФИЗАЦИЯ', () => {
    expect(T).toContain('анти-катастрофизация');
  });
  it('запрещает «невыносимо», «всё рушится», стак-через-ходы', () => {
    expect(T).toMatch(/не\s+усиливай\s+негатив\s+словами\s+«невыносимо»/);
    expect(T).toMatch(/«всё\s+рушится»/);
    expect(T).toMatch(/не\s+суммируй\s+проблемы\s+юзера\s+через\s+ходы/);
  });
  it('требует ввод ОПОРЫ после отражения + дверь к АГЕНТНОСТИ', () => {
    expect(T).toMatch(/мягко\s+вводи\s+опору/);
    expect(T).toMatch(/дверь\s+к\s+агентности/);
  });

  // ----- P1b: ban safety-assessment вопросов в therapeutic -----
  it('запрещает safety-assessment вопросы в обычной эмо-беседе', () => {
    expect(T).toMatch(/safety-assessment\s+вопросы/);
    expect(T).toMatch(/«ты\s+сейчас\s+один\?»/);
    expect(T).toMatch(/«есть\s+мысли\s+причинить\s+себе\s+вред\?»/);
    expect(T).toMatch(
      /территория\s+safety-template\s+только\s+при\s+явном\s+кризис/,
    );
  });
});
