import { describe, it, expect } from 'vitest';
import {
  classifyGoal,
  parsePlanTree,
  goalAreaFor,
  mondayUTC,
  planTreeToRows,
  plannerMayPatchParent,
  rebuildDecision,
  localTodayUTC,
  type PlanTree,
} from './planner-service.js';

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

describe('P2 4/5 — rebuildDecision (re-decompose, non-destructive)', () => {
  it('нет активных детей → fresh (строим с нуля)', () => {
    expect(rebuildDecision(0, false)).toBe('fresh');
    expect(rebuildDecision(0, true)).toBe('fresh');
  });
  it('есть активные + rebuild=false → skip (W6 честно)', () => {
    expect(rebuildDecision(4, false)).toBe('skip');
  });
  it('есть активные + rebuild=true → rebuild (архив старых, не снос)', () => {
    expect(rebuildDecision(4, true)).toBe('rebuild');
  });
});

describe('L99/W12 — planner не перезаписывает user-цель', () => {
  // Named SSOT-граница non-destructive: patch target/pacing родителя
  // разрешён ТОЛЬКО когда planner сам создал YearlyGoal в этом
  // вызове. Найденную/ручную (derivedFrom=user) цель — никогда
  // (иначе «разбей мою цель» затрёт ручной target). DB-запись —
  // доверенный glue, как materializeImport; тестируем решение.
  it('planner создал родителя сейчас → patch разрешён', () => {
    expect(plannerMayPatchParent(true)).toBe(true);
  });
  it('родитель найден/ручной → patch запрещён (target цел)', () => {
    expect(plannerMayPatchParent(false)).toBe(false);
  });
});

describe('goalAreaFor — детерминированная area', () => {
  it.each([
    ['накопить миллион', 'finance'],
    ['сбросить 10 кг', 'health'],
    ['медитировать каждый день', 'spirituality'],
    ['прочитать 50 книг', 'career'],
    ['погладить кота', 'personal'],
  ])('«%s» → %s', (t, a) => expect(goalAreaFor(t)).toBe(a));
});

describe('L99/W11 — weekStart в tz юзера, не сырой UTC', () => {
  // Алматы UTC+5 (без DST). 2026-05-17T19:30Z = вс 19:30 UTC =
  // ПН 00:30 по Алматы. Наивный UTC дал бы прошлый понедельник
  // (баг класса get_today). localTodayUTC+mondayUTC → правильный
  // понедельник недели юзера.
  const sundayNightUTC = new Date('2026-05-17T19:30:00Z');
  it('пн 00:30 Алматы (=вс UTC) → локальная дата = 2026-05-18', () => {
    expect(localTodayUTC('Asia/Almaty', sundayNightUTC).toISOString()).toBe(
      '2026-05-18T00:00:00.000Z',
    );
  });
  it('mondayUTC(localToday) = пн недели юзера (2026-05-18), НЕ 05-11', () => {
    const wk = mondayUTC(localTodayUTC('Asia/Almaty', sundayNightUTC));
    expect(wk.toISOString()).toBe('2026-05-18T00:00:00.000Z');
    // доказываем баг наивного UTC: он дал бы прошлый понедельник
    expect(mondayUTC(sundayNightUTC).toISOString()).toBe(
      '2026-05-11T00:00:00.000Z',
    );
  });
  it('UTC-midday того же дня → та же локальная дата', () => {
    expect(
      localTodayUTC('Asia/Almaty', new Date('2026-05-18T12:00:00Z')).toISOString(),
    ).toBe('2026-05-18T00:00:00.000Z');
  });
});

describe('mondayUTC — начало ISO-недели UTC', () => {
  it('среда → понедельник той же недели', () => {
    // 2026-05-20 = среда → 2026-05-18 пн
    expect(mondayUTC(new Date('2026-05-20T12:00:00Z')).toISOString()).toBe(
      '2026-05-18T00:00:00.000Z',
    );
  });
  it('воскресенье → понедельник ТОЙ ЖЕ недели (не следующей)', () => {
    // 2026-05-24 вс → 2026-05-18 пн
    expect(mondayUTC(new Date('2026-05-24T23:00:00Z')).toISOString()).toBe(
      '2026-05-18T00:00:00.000Z',
    );
  });
  it('понедельник → сам себя 00:00', () => {
    expect(mondayUTC(new Date('2026-05-18T09:30:00Z')).toISOString()).toBe(
      '2026-05-18T00:00:00.000Z',
    );
  });
});

describe('planTreeToRows — чистый маппер PlanTree → строки БД', () => {
  const tree: PlanTree = {
    pacingMode: 'custom',
    target: 10,
    weeks: [
      { text: 'неделя 1', metric: '−0.5 кг' },
      { text: 'неделя 2' },
    ],
    habit: { name: 'дефицит 400 ккал', frequency: 'daily' },
    milestones: [{ label: '−3 кг', by: '2026-06-30' }],
    rationale: 'r',
    spokenResponse: 's',
  };
  const rows = planTreeToRows(tree, 'goal123', 'health', new Date('2026-05-20T00:00:00Z'));

  it('weeklyGoals: weekStart=пн+i·7, order=i, planParent/derivedFrom', () => {
    expect(rows.weeklyGoals).toHaveLength(2);
    expect(rows.weeklyGoals[0].weekStart.toISOString()).toBe(
      '2026-05-18T00:00:00.000Z',
    );
    expect(rows.weeklyGoals[1].weekStart.toISOString()).toBe(
      '2026-05-25T00:00:00.000Z',
    );
    expect(rows.weeklyGoals[0].goalText).toBe('неделя 1 (−0.5 кг)');
    expect(rows.weeklyGoals[1].order).toBe(1);
    expect(rows.weeklyGoals[0].planParentId).toBe('goal123');
    expect(rows.weeklyGoals[0].derivedFrom).toBe('planner');
  });

  it('habit: legacy goalId + planParentId + derivedFrom planner', () => {
    expect(rows.habit).not.toBeNull();
    expect(rows.habit!.goalId).toBe('goal123');
    expect(rows.habit!.planParentId).toBe('goal123');
    expect(rows.habit!.category).toBe('health');
    expect(rows.habit!.derivedFrom).toBe('planner');
  });

  it('yearlyPatch: custom → pacingPlan=milestones', () => {
    expect(rows.yearlyPatch.target).toBe(10);
    expect(rows.yearlyPatch.pacingMode).toBe('custom');
    expect(rows.yearlyPatch.pacingPlan).toHaveLength(1);
  });

  it('uniform → pacingPlan=null (квартал на лету)', () => {
    const u = planTreeToRows(
      { ...tree, pacingMode: 'uniform', milestones: [{ label: 'x' }] },
      'g',
      'career',
      new Date('2026-05-18T00:00:00Z'),
    );
    expect(u.yearlyPatch.pacingPlan).toBeNull();
  });

  it('нет habit → habit:null, недели всё равно есть', () => {
    const n = planTreeToRows(
      { ...tree, habit: null },
      'g',
      'career',
      new Date('2026-05-18T00:00:00Z'),
    );
    expect(n.habit).toBeNull();
    expect(n.weeklyGoals.length).toBeGreaterThan(0);
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
