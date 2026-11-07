import { toLifeAnalysis, type ServerLifeAnalysis } from '@/services/life-insights';

const base: ServerLifeAnalysis = {
  financial: {
    monthlyBurn: 200000,
    monthlyIncome: 350000,
    savingsRate: 42.86,
    topMoneyDrains: [
      { category: 'food', amount: 90000, percentOfIncome: 25.7 },
      { category: 'transport', amount: 50000, percentOfIncome: 14.3 },
      { category: 'zzz', amount: 1000, percentOfIncome: 0.3 },
      { category: 'other', amount: 500, percentOfIncome: 0.1 },
    ],
    daysUntilBroke: null,
    canAffordApartment: { years: 7.4, currentSavingsRate: 42, neededSavingsRate: 50 },
    costOfLife: { daily: 6667, monthly: 200000, yearly: 2400000 },
    financialDecisionsToPoverty: ['Еда съедает 45% расходов'],
    cashFlowGaps: [{ period: 'Октябрь', deficit: 12000 }],
    wastefulSpending: [{ category: 'food', amount: 90000, suggestion: 'Готовь дома' }],
  },
  health: {
    avgSleepHours: 5.46,
    avgMoodScore: 3,
    avgEnergyScore: 3,
    exerciseFrequency: '2 раза в неделю',
    stepsPerDay: 0,
    burnoutRisk: 'high',
    bodyWarnings: [],
    mentalHealthFlags: [],
  },
  life: {
    goalsOnTrack: 2,
    goalsBehind: 1,
    habitConsistency: 63.4,
    worstHabits: ['Чтение'],
    productivityTrend: 'declining',
    streakStatus: { current: 4, best: 9 },
    lifeCostPerDay: 6667,
  },
  aiSummary: 'Берик, ты держишься.',
};

describe('toLifeAnalysis — ответ сервера → экран «Разбор»', () => {
  const now = new Date(2026, 10, 7, 12);
  const r = toLifeAnalysis(base, now);

  it('финансы: суммы, доли от расходов, русские названия, топ-3', () => {
    expect(r.financial.monthlyBurnRate).toBe(200000);
    expect(r.financial.savingsRate).toBe(43);
    expect(r.financial.topDrains).toHaveLength(3);
    expect(r.financial.topDrains[0]).toMatchObject({ label: 'Еда', amount: 90000, percent: 45 });
    expect(r.financial.topDrains[2].label).toBe('zzz');
    expect(r.financial.apartmentTimeline).toMatch(/7 лет/);
    expect(r.financial.cashFlowGaps[0]).toMatch(/Октябрь: не хватает 12\s000 ₸/);
  });

  it('здоровье: сон с оценкой, шаги 0 (шагомера нет), выгорание в %', () => {
    expect(r.health.sleepHours).toBe(5.5);
    expect(r.health.sleepSeverity).toBe('danger');
    expect(r.health.stepsPerDay).toBe(0);
    expect(r.health.burnoutRisk).toBe(75);
  });

  it('цели/привычки/тренд/вывод ИИ', () => {
    expect(r.progress).toMatchObject({ goalsOnTrack: 2, goalsBehind: 1, goalsTotal: 3, habitConsistency: 63, productivityTrend: 'down', currentStreak: 4 });
    expect(r.progress.worstHabits).toEqual([{ name: 'Чтение' }]);
    expect(r.aiVerdict).toBe('Берик, ты держишься.');
    expect(r.sparse).toBe(false);
  });

  it('совет «где урезать» → задача на сегодня в формате сервера', () => {
    expect(r.exitStrategies[0]).toMatchObject({
      text: 'Готовь дома',
      actionType: 'task',
      actionData: { category: 'finance', priority: 'medium', date: '2026-11-07' },
    });
    expect(r.exitStrategies[0].actionData.title).toMatch(/^Сократить: еда/);
  });

  it('пустой аккаунт — sparse, без процента накоплений и квартиры', () => {
    const empty = toLifeAnalysis(
      {
        ...base,
        financial: { ...base.financial, monthlyBurn: 0, monthlyIncome: 0, savingsRate: null, topMoneyDrains: [], canAffordApartment: null, wastefulSpending: [] },
        health: { ...base.health, avgSleepHours: null },
        life: { ...base.life, goalsOnTrack: 0, goalsBehind: 0, habitConsistency: 0 },
      },
      now,
    );
    expect(empty.sparse).toBe(true);
    expect(empty.financial.savingsRate).toBeNull();
    expect(empty.financial.apartmentTimeline).toBeNull();
    expect(empty.health.sleepHours).toBeNull();
    expect(empty.exitStrategies).toEqual([]);
  });
});
