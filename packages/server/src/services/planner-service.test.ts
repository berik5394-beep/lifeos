import { describe, it, expect } from 'vitest';
import { classifyGoal, parsePlanTree } from './planner-service.js';

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

describe('parsePlanTree — разбор без сети, честный отказ (bug-#1)', () => {
  const uniform = JSON.stringify({
    pacingMode: 'uniform',
    target: 50,
    weeks: [{ text: '≈1 книга в неделю', metric: '~150 стр' }],
    habit: { name: '30 страниц перед сном', frequency: 'daily' },
    milestones: [{ label: 'Q1', target: 13 }],
    rationale: '50/52 ≈ 1/нед',
    spokenResponse: 'Разложил по неделям',
  });

  it('валидный JSON → PlanTree', () => {
    const p = parsePlanTree(uniform)!;
    expect(p.pacingMode).toBe('uniform');
    expect(p.target).toBe(50);
    expect(p.weeks).toHaveLength(1);
    expect(p.habit?.name).toContain('30 страниц');
    // uniform → milestones игнорируются (квартал на лету)
    expect(p.milestones).toBeNull();
  });

  it('```json-обёртка снимается', () => {
    expect(parsePlanTree('```json\n' + uniform + '\n```')).not.toBeNull();
  });

  it('custom → milestones[] сохраняются', () => {
    const p = parsePlanTree(
      JSON.stringify({
        pacingMode: 'custom',
        target: 10,
        weeks: [{ text: '−0.5 кг/нед' }],
        habit: { name: 'дефицит 400 ккал', frequency: 'daily' },
        milestones: [{ label: '−3 кг', by: '2026-06-30' }],
        rationale: 'быстрее в начале',
        spokenResponse: 'ок',
      }),
    )!;
    expect(p.pacingMode).toBe('custom');
    expect(p.milestones).toHaveLength(1);
    expect(p.milestones![0].by).toBe('2026-06-30');
  });

  it.each([
    '',
    'не json вообще',
    '{битый',
    JSON.stringify({ pacingMode: 'uniform', weeks: [] }), // пусто → null
    JSON.stringify({ weeks: [{ no_text: 1 }] }), // нет валидных недель
  ])('мусор/пусто «%s» → null (НЕ выдуманное дерево)', (raw) =>
    expect(parsePlanTree(raw)).toBeNull(),
  );

  it('нет habit → дерево валидно, habit:null', () => {
    const p = parsePlanTree(
      JSON.stringify({ pacingMode: 'uniform', weeks: [{ text: 'шаг' }] }),
    )!;
    expect(p).not.toBeNull();
    expect(p.habit).toBeNull();
  });
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
