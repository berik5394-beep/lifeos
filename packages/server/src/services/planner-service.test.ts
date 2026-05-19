import { describe, it, expect } from 'vitest';
import { classifyGoal } from './planner-service.js';

/**
 * Phase 5 P2 — классификатор «разбивать ли цель». Детерминированно
 * (как intent-parser/capture-gate). 5 спек-кейсов Берика + границы
 * + conservative-bias (спорное → keep_atomic).
 */

describe('classifyGoal — 5 спек-кейсов Phase 5', () => {
  it.each([
    'прочитать 50 книг за год',
    'накопить миллион к Новому году',
    'выучить английский',
    'сбросить 10 кг',
  ])('«%s» → decompose (жизненная измеримая цель)', (t) =>
    expect(classifyGoal(t)).toBe('decompose'),
  );

  it('«встреча с инвестором» → keep_atomic (разовое, НЕ разбивать)', () =>
    expect(classifyGoal('встреча с инвестором')).toBe('keep_atomic'),
  );
});

describe('classifyGoal — decompose (обучение/навык/финансы/здоровье)', () => {
  it.each([
    'хочу читать каждый день по 30 страниц',
    'научиться играть на гитаре',
    'накопить на квартиру',
    'сэкономить 500000 за год',
    'бегать 3 раза в неделю',
    'подтянуть форму к лету',
    'пройти курс по питону',
  ])('«%s» → decompose', (t) => expect(classifyGoal(t)).toBe('decompose'));
});

describe('classifyGoal — partial (проект + дедлайн → milestones)', () => {
  it.each([
    'запустить сайт к 1 сентября',
    'сделать проект к дедлайну',
    'подготовить релиз MVP к марту',
    'защитить диплом до июня',
  ])('«%s» → partial', (t) => expect(classifyGoal(t)).toBe('partial'));
});

describe('classifyGoal — keep_atomic (разовое + conservative default)', () => {
  it.each([
    'встреча с инвестором',
    'купить молоко',
    'позвонить маме',
    'день рождения у Серика',
    'записаться к стоматологу',
    'забрать посылку',
    'отправить отчёт',
    'погладить кота', // спорное/бессмысленное → дефолт keep_atomic
  ])('«%s» → keep_atomic', (t) =>
    expect(classifyGoal(t)).toBe('keep_atomic'),
  );
});
