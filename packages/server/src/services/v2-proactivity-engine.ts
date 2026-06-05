/**
 * v2.0 Week 5 — Proactivity Engine.
 *
 * Single source of truth for outbound proactive nudges based on the new
 * memory tiers (semantic / episodic / procedural / emotional). Runs per
 * scheduler tick (every 10 min, behind FEATURE_V2_PROACTIVITY flag).
 *
 * Flow: runForUser → detectCandidates (13 detectors) → filterCandidates
 * (4 gates in order: DND, RateLimit, Significance, Dedup) → pick top by
 * significance → generateNudge (template lookup → Claude haiku fallback)
 * → deliverTopInsight (existing R6 push pipeline).
 *
 * All detectors and gates are best-effort: a thrown error in one detector
 * never kills the tick (Promise.allSettled / per-detector try/catch).
 */

// ---- Public types ---------------------------------------------------------

export type NudgeSource =
  | 'stale_entity'
  | 'commitment_due'
  | 'mood_shift'
  | 'streak_break'
  | 'goal_no_progress'
  | 'identity_growth'
  | 'skill_suggestion'
  | 'obligation_due'
  | 'goal_impact'
  | 'runway_low'
  | 'energy_link'
  | 'relationship_link'
  | 'decision_review';

export type NudgeTone = 'gentle' | 'curious' | 'supportive' | 'celebratory';

export type NudgeCandidate = {
  source: NudgeSource;
  significance: number; // 0..1
  entityId?: string;
  patternId?: string;
  payload: Record<string, unknown>;
  toneHint: NudgeTone;
};

export interface ProactivityEngine {
  runForUser(userId: string): Promise<{
    candidatesFound: number;
    candidatesAfterFilter: number;
    nudgesDelivered: number;
  }>;
  detectCandidates(userId: string): Promise<NudgeCandidate[]>;
  filterCandidates(
    userId: string,
    candidates: NudgeCandidate[],
  ): Promise<NudgeCandidate[]>;
  generateNudge(userId: string, candidate: NudgeCandidate): Promise<string>;
}

// ---- Pure helpers ---------------------------------------------------------

export function scoreSignificance(c: NudgeCandidate): number {
  switch (c.source) {
    case 'stale_entity': {
      const gapRatio = Number(c.payload.gapRatio ?? 0);
      const importance = Number(c.payload.importance ?? 5);
      return Math.min(1, (gapRatio / 5) * (importance / 10));
    }
    case 'commitment_due': {
      const daysOverdue = Number(c.payload.daysOverdue ?? 0);
      return Math.min(1, 0.5 + daysOverdue / 14);
    }
    case 'mood_shift': {
      const magnitude = Math.abs(Number(c.payload.magnitude ?? 0));
      return Math.min(1, magnitude);
    }
    case 'streak_break': {
      const consistency = Number(c.payload.consistency ?? 0);
      return Math.max(0, Math.min(1, consistency * 0.8));
    }
    case 'goal_no_progress': {
      const daysSilent = Number(c.payload.daysSilent ?? 0);
      return Math.min(1, daysSilent / 14);
    }
    case 'identity_growth': {
      const depthShift = Number(c.payload.depthShift ?? 0);
      return Math.min(1, depthShift * 3);
    }
    case 'skill_suggestion': {
      const recurrence = Number(c.payload.recurrence ?? 0);
      const size = Number(c.payload.clusterSize ?? 0);
      return Math.min(1, (recurrence / 10) * (size / 4));
    }
    case 'obligation_due': {
      // Просроченные/висящие обязательства — стабильно значимы.
      return 0.6;
    }
    case 'decision_review': {
      // Решение, которому пора ретро — стабильно значимо. 0.6 = на уровне
      // obligation_due: ниже порог-гейта (gate3 >= 0.6) нудж бы НЕ доходил.
      return 0.6;
    }
    case 'goal_impact': {
      // Доля категории от месячной нормы цели (0..N) → значимость.
      // 25% нормы ≈ 0.5; чем больше «съедает», тем значимее.
      const share = Number(c.payload.share ?? 0) / 100;
      return Math.max(0, Math.min(1, share * 2));
    }
    case 'runway_low': {
      const status = String(c.payload.status ?? 'short');
      return status === 'critical' ? 0.9 : status === 'underwater' ? 0.8 : 0.7;
    }
    case 'energy_link': {
      const gap = Math.abs(Number(c.payload.gap ?? 0));
      return Math.max(0, Math.min(0.85, gap / 50));
    }
    case 'relationship_link': {
      const days = Number(c.payload.daysSince ?? 0);
      const imp = Number(c.payload.importance ?? 5);
      return Math.max(0, Math.min(0.85, (days / 30) * (imp / 10)));
    }
  }
}

export function gate3_Significance(
  c: NudgeCandidate,
  threshold = 0.6,
): boolean {
  return c.significance >= threshold;
}

export function interpolate(
  template: string,
  payload: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = payload[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

// ---- Templates ------------------------------------------------------------
// Keep small/safe — Claude fallback handles long-tail tone/personalisation.

export const TEMPLATES: Record<NudgeSource, Partial<Record<NudgeTone, string>>> = {
  stale_entity: {
    gentle:
      'Слушай, давно ничего не было про {{name}} — как там у вас? Прошло {{daysSinceLast}} дней.',
    curious:
      'Кстати, {{name}} — что нового? Обычно вы пересекаетесь чаще.',
    supportive:
      'Помню, в последний раз с {{name}} было непросто. Как сейчас?',
  },
  commitment_due: {
    gentle:
      'Ты обещал «{{commitment}}» — прошло {{daysOverdue}} дней. Получилось?',
    curious: 'Как там «{{commitment}}»? Уже {{daysOverdue}} дней прошло.',
  },
  obligation_due: {
    gentle: 'Ты обещал {{person}}: «{{description}}» — срок {{dueLabel}}. Закрыл?',
    curious: 'Как там с {{person}} — «{{description}}»? {{dueLabel}}.',
    supportive:
      '{{person}} ждёт «{{description}}». Срок {{dueLabel}} — напомнить или закрыть?',
  },
  decision_review: {
    gentle: '{{weeks}} нед назад ты решил «{{title}}»{{expectedSuffix}} — как вышло?',
    curious: 'Помнишь решение «{{title}}»? {{weeks}} нед прошло — как на самом деле?',
    supportive:
      'Пора оглянуться: «{{title}}» ({{weeks}} нед назад). Сработало или нет?',
  },
  mood_shift: {
    supportive:
      'Замечаю, настроение последние дни ушло в минус. Хочешь — поговорим?',
    gentle: 'Кажется, неделя была тяжёлой. Как ты сейчас?',
  },
  streak_break: {
    gentle:
      'Цепочка по «{{habit}}» прервалась — это окей, не обязан сегодня. Просто отмечаю.',
    celebratory:
      'Помню, ты держал «{{habit}}» долго — захочешь подхватить, я рядом.',
  },
  goal_no_progress: {
    curious:
      'Цель «{{goal}}» — тишина уже {{daysSilent}} дней. Цель ещё актуальна?',
    gentle:
      'Давно не двигали «{{goal}}». Скорректировать или отпустить?',
  },
  identity_growth: {
    // identity_growth uses growth narrative (Claude haiku), not templates.
    // Leave empty to skip template lookup in generateNudge.
  },
  skill_suggestion: {
    curious: 'Заметил, что ты часто просишь одно и то же подряд. Хочешь, соберу это в навык — будешь запускать одной фразой?',
    gentle: 'Могу сделать тебе навык из того, что ты часто делаешь вместе. Сэкономит время. Сделать?',
  },
  goal_impact: {
    gentle: '«{{category}}» съела {{share}}% месячной нормы на цель «{{goal}}». Поднажмём?',
    curious: 'Заметил: «{{category}}» = {{share}}% от того, что нужно на «{{goal}}». Подвинем?',
    supportive: 'Цель «{{goal}}» отстаёт; «{{category}}» ест {{share}}% нормы. Перенаправим — нагоним.',
  },
  runway_low: {
    gentle: 'По записям денег хватит на ~{{months}} мес ({{cash}}₸). Поджать траты?',
    curious: 'Заметил: при таком темпе кэша на ~{{months}} мес. Разберём бюджет?',
    supportive: 'Запас короткий — ~{{months}} мес. Давай прикинем, где сократить.',
  },
  energy_link: {
    gentle: 'Ты продуктивнее при сне ≥7ч ({{goodAvg}}% против {{poorAvg}}%). На этой неделе спишь меньше — выспись?',
    curious: 'Заметил: при сне ≥7ч у тебя {{goodAvg}}% дел, при <7ч — {{poorAvg}}%. Недосып бьёт по делам.',
    supportive: 'Похоже, недосып тянет продуктивность ({{goodAvg}}% vs {{poorAvg}}%). Дай себе отдохнуть.',
  },
  relationship_link: {
    gentle: 'Не общался с {{name}} уже {{days}} дн, а по нему висит: «{{description}}». Напишешь?',
    curious: 'Кстати, {{name}} — {{days}} дн тишины, а у вас открыто «{{description}}». Решим?',
    supportive: '{{name}} давно без вестей ({{days}} дн), и есть «{{description}}». Хочешь — помогу составить сообщение.',
  },
};

// ---- Detectors (A2-A3) -------------------------------------------------------

import { getEntityGraph } from './entity-graph/index.js';
import { getProceduralMemory } from './procedural-memory.singleton.js';
import { lastEventForEntity } from './episodic-memory.js';
import { getEmotionalMemory } from './emotional-memory.singleton.js';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC, localHour } from '../lib/tz.js';
import { runAgent } from './claude-agent.js';
import { getEngagement, adaptiveThreshold } from './engagement/index.js';
import { isV2EngagementEnabled } from '../lib/feature-flags.js';
import { getBotIdentityService } from './bot-identity.singleton.js';
import { persistCandidates } from './insight-store.js';
import type { InsightCandidate } from './insight-core.js';
import { getBotTraitsStore } from './bot-traits/index.js';
import { generateGrowthNarrative } from './bot-traits/growth-narrative.js';

const DAY_MS = 86_400_000;

async function detectStaleEntity(userId: string): Promise<NudgeCandidate[]> {
  try {
    const graph = getEntityGraph();
    const procedural = getProceduralMemory();
    const stale = await graph.staleEntities(userId, 7, 5);
    const out: NudgeCandidate[] = [];
    const now = Date.now();
    for (const ent of stale) {
      const last = await lastEventForEntity(userId, ent.id).catch(() => null);
      const lastAt = last?.validAt?.getTime() ?? ent.lastSeenAt?.getTime() ?? now;
      const daysSinceLast = Math.max(1, Math.floor((now - lastAt) / DAY_MS));
      const patterns = await procedural
        .getActivePatterns(userId, { kinds: ['frequency'] })
        .catch(() => []);
      const freqPattern = patterns.find((p) => {
        const payload = (p.payload ?? {}) as Record<string, unknown>;
        return payload.entityId === ent.id;
      });
      const period = Number((freqPattern?.payload as Record<string, unknown>)?.periodDays ?? 0);
      if (period <= 0) continue;
      const gapRatio = daysSinceLast / period;
      if (gapRatio < 1.5) continue;
      const cand: NudgeCandidate = {
        source: 'stale_entity',
        significance: 0,
        entityId: ent.id,
        patternId: freqPattern?.id,
        payload: {
          name: ent.name,
          daysSinceLast,
          gapRatio,
          importance: ent.importance,
        },
        toneHint: 'gentle',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectStaleEntity failed:', err);
    return [];
  }
}

async function detectCommitmentDue(userId: string): Promise<NudgeCandidate[]> {
  try {
    const procedural = getProceduralMemory();
    const patterns = await procedural.getActivePatterns(userId, {
      kinds: ['commitment'],
    });
    const now = Date.now();
    const out: NudgeCandidate[] = [];
    for (const p of patterns) {
      const payload = (p.payload ?? {}) as Record<string, unknown>;
      const dueAt = payload.dueAt ? new Date(String(payload.dueAt)).getTime() : NaN;
      if (!Number.isFinite(dueAt) || dueAt > now) continue;
      const daysOverdue = Math.max(0, Math.floor((now - dueAt) / DAY_MS));
      const cand: NudgeCandidate = {
        source: 'commitment_due',
        significance: 0,
        patternId: p.id,
        entityId: (payload.entityId as string) ?? undefined,
        payload: {
          commitment: String(payload.text ?? ''),
          daysOverdue,
        },
        toneHint: 'curious',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectCommitmentDue failed:', err);
    return [];
  }
}

// Obligations: открытые обязательства, просроченные ИЛИ висящие без срока >5 дней.
async function detectObligationDue(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2ObligationsEnabled } = await import('../lib/feature-flags.js');
    if (!isV2ObligationsEnabled(userId)) return [];
    const { prisma } = await import('../lib/prisma.js');
    const now = Date.now();
    const rows = await prisma.obligation.findMany({
      where: { userId, status: 'open' },
      orderBy: [{ dueDate: 'asc' }],
      take: 20,
    });
    const out: NudgeCandidate[] = [];
    for (const o of rows) {
      const due = o.dueDate ? o.dueDate.getTime() : NaN;
      const isDue = Number.isFinite(due) && due <= now;
      const ageDays = Math.floor((now - o.createdAt.getTime()) / DAY_MS);
      if (!isDue && !(Number.isNaN(due) && ageDays > 5)) continue;
      const dueLabel = Number.isFinite(due)
        ? `был ${o.dueDate!.toISOString().slice(0, 10)}`
        : `висит ${ageDays} дней`;
      const cand: NudgeCandidate = {
        source: 'obligation_due',
        significance: 0,
        entityId: o.personEntityId ?? undefined,
        payload: {
          person: o.personName,
          description: o.description,
          dueLabel,
          direction: o.direction,
        },
        toneHint: 'gentle',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectObligationDue failed:', err);
    return [];
  }
}

async function detectDecisionReview(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2DecisionsEnabled } = await import('../lib/feature-flags.js');
    if (!isV2DecisionsEnabled(userId)) return [];
    const { prisma } = await import('../lib/prisma.js');
    const now = Date.now();
    const rows = await prisma.decision.findMany({
      where: { userId, status: 'open' },
      orderBy: [{ reviewDate: 'asc' }],
      take: 20,
    });
    const out: NudgeCandidate[] = [];
    for (const d of rows) {
      const due = d.reviewDate.getTime();
      if (due > now) continue;
      const weeks = Math.max(1, Math.floor((now - d.decidedAt.getTime()) / (7 * DAY_MS)));
      const cand: NudgeCandidate = {
        source: 'decision_review',
        significance: 0,
        payload: {
          title: d.title,
          weeks,
          expectedSuffix: d.expectedOutcome ? `, ожидал «${d.expectedOutcome}»` : '',
        },
        toneHint: 'curious',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectDecisionReview failed:', err);
    return [];
  }
}

// Goal-Impact: вычисленное влияние трат/долгов на денежную цель. Кандидат если
// топ-категория ест ≥25% месячной нормы ИЛИ долги сдвигают цель на ≥1 мес.
async function detectGoalImpact(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2GoalImpactEnabled } = await import('../lib/feature-flags.js');
    if (!isV2GoalImpactEnabled(userId)) return [];
    const { buildGoalImpact } = await import('./goal-impact/index.js');
    const gi = await buildGoalImpact(userId);
    if (!gi) return [];
    const share = gi.categoryShare ?? 0;
    const delay = gi.monthsDelay ?? 0;
    if (share < 0.25 && delay < 1) return [];
    const cand: NudgeCandidate = {
      source: 'goal_impact',
      significance: 0,
      payload: {
        goal: gi.goalText,
        category: gi.topCategory?.category ?? '',
        share: String(Math.round(share * 100)),
      },
      toneHint: 'gentle',
    };
    cand.significance = scoreSignificance(cand);
    return [cand];
  } catch (err) {
    console.warn('[v2-proactivity] detectGoalImpact failed:', err);
    return [];
  }
}

// Runway: короткий запас денег (по записям). Кандидат при short/critical/underwater.
async function detectRunwayLow(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2RunwayEnabled } = await import('../lib/feature-flags.js');
    if (!isV2RunwayEnabled(userId)) return [];
    const { buildRunway } = await import('./runway/index.js');
    const rw = await buildRunway(userId);
    if (!rw) return [];
    if (rw.status !== 'short' && rw.status !== 'critical' && rw.status !== 'underwater') {
      return [];
    }
    const months = rw.runwayMonths == null ? 0 : Math.round(rw.runwayMonths * 10) / 10;
    const cand: NudgeCandidate = {
      source: 'runway_low',
      significance: 0,
      payload: {
        months: String(months),
        cash: String(Math.round(rw.cashOnHand)),
        status: rw.status,
      },
      toneHint: 'gentle',
    };
    cand.significance = scoreSignificance(cand);
    return [cand];
  } catch (err) {
    console.warn('[v2-proactivity] detectRunwayLow failed:', err);
    return [];
  }
}

// Energy↔Result: связь сон↔выполнение подтверждена И недавно недосып.
async function detectEnergyLink(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2EnergyEnabled } = await import('../lib/feature-flags.js');
    if (!isV2EnergyEnabled(userId)) return [];
    const { buildEnergyLink } = await import('./energy-link/index.js');
    const el = await buildEnergyLink(userId);
    if (!el) return [];
    if (el.status !== 'link' || !el.recentSleepLow) return [];
    const cand: NudgeCandidate = {
      source: 'energy_link',
      significance: 0,
      payload: {
        goodAvg: String(el.goodAvg ?? ''),
        poorAvg: String(el.poorAvg ?? ''),
        gap: String(el.gapPct ?? 0),
      },
      toneHint: 'gentle',
    };
    cand.significance = scoreSignificance(cand);
    return [cand];
  } catch (err) {
    console.warn('[v2-proactivity] detectEnergyLink failed:', err);
    return [];
  }
}

// Relationships: застоявшийся человек × открытое обязательство по нему (FK).
async function detectRelationshipLink(userId: string): Promise<NudgeCandidate[]> {
  try {
    const { isV2RelationshipsEnabled } = await import('../lib/feature-flags.js');
    if (!isV2RelationshipsEnabled(userId)) return [];
    const { buildRelationshipNudge } = await import('./relationship-link/index.js');
    const rn = await buildRelationshipNudge(userId);
    if (!rn) return [];
    const cand: NudgeCandidate = {
      source: 'relationship_link',
      significance: 0,
      payload: {
        name: rn.personName,
        description: rn.description,
        days: String(rn.daysSince),
        daysSince: String(rn.daysSince),
        importance: String(rn.importance),
      },
      toneHint: 'gentle',
    };
    cand.significance = scoreSignificance(cand);
    return [cand];
  } catch (err) {
    console.warn('[v2-proactivity] detectRelationshipLink failed:', err);
    return [];
  }
}

async function detectMoodShift(userId: string): Promise<NudgeCandidate[]> {
  try {
    const emotional = getEmotionalMemory();
    const shift = await emotional.detectMoodShift(userId);
    if (!shift) return [];
    const magnitude = Number(shift.magnitude ?? 0);
    if (Math.abs(magnitude) < 0.4) return [];
    const cand: NudgeCandidate = {
      source: 'mood_shift',
      significance: 0,
      payload: {
        magnitude,
        direction: shift.direction,
        sinceDays: shift.sinceDays,
      },
      toneHint: magnitude < 0 ? 'supportive' : 'celebratory',
    };
    cand.significance = scoreSignificance(cand);
    return [cand];
  } catch (err) {
    console.warn('[v2-proactivity] detectMoodShift failed:', err);
    return [];
  }
}

async function detectStreakBreak(userId: string): Promise<NudgeCandidate[]> {
  try {
    const procedural = getProceduralMemory();
    const habits = await prisma.habit.findMany({
      where: { userId, archivedAt: null },
      select: { id: true, name: true },
    });
    if (habits.length === 0) return [];
    const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS);
    const recent = await prisma.habitLog.findMany({
      where: {
        habitId: { in: habits.map((h) => h.id) },
        completed: true,
        date: { gte: twoDaysAgo },
      },
      select: { habitId: true },
    });
    const activeIds = new Set(recent.map((r) => r.habitId));
    const out: NudgeCandidate[] = [];
    for (const h of habits) {
      if (activeIds.has(h.id)) continue;
      const patterns = await procedural
        .getActivePatterns(userId, { kinds: ['streak_break'] })
        .catch(() => []);
      const streakPattern = patterns.find((p) => {
        const payload = (p.payload ?? {}) as Record<string, unknown>;
        return payload.habitId === h.id;
      });
      if (!streakPattern) continue;
      const consistency = Number(streakPattern.confidence ?? 0);
      const cand: NudgeCandidate = {
        source: 'streak_break',
        significance: 0,
        patternId: streakPattern.id,
        entityId: h.id,
        payload: { habit: h.name, consistency },
        toneHint: 'gentle',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectStreakBreak failed:', err);
    return [];
  }
}

async function detectIdentityGrowth(userId: string): Promise<NudgeCandidate[]> {
  try {
    const store = getBotTraitsStore();
    const history = await store.snapshotHistory(userId, 50);
    if (history.length < 2) return [];
    const current = await store.getTraits(userId);

    // 30-day dedup: last identity_growth comment.
    const lastComment = await prisma.insight.findFirst({
      where: { userId, source: 'v2-proactivity', kind: 'identity_growth' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const daysSince = lastComment
      ? (Date.now() - lastComment.createdAt.getTime()) / 86400_000
      : Infinity;
    if (daysSince < 30) return [];

    // Baseline = first snapshot after last comment, else oldest snapshot.
    const baseline = lastComment
      ? history.find((h) => h.recordedAt > lastComment.createdAt) ?? history[0]
      : history[0];
    const depthShift = current.relationshipDepth - baseline.depth;
    if (depthShift < 0.15) return [];

    const cand: NudgeCandidate = {
      source: 'identity_growth',
      significance: 0,
      payload: { depthShift, baseline, current },
      toneHint: 'warm' as any,
    };
    cand.significance = scoreSignificance(cand);
    return [cand];
  } catch (err) {
    console.warn('[proactivity:identity-growth] failed:', err);
    return [];
  }
}

async function detectGoalNoProgress(userId: string): Promise<NudgeCandidate[]> {
  try {
    const goals = await prisma.yearlyGoal.findMany({
      where: { userId },
      select: { id: true, goalText: true, updatedAt: true },
    });
    if (goals.length === 0) return [];
    const now = Date.now();
    const out: NudgeCandidate[] = [];
    for (const g of goals) {
      const lastAt = g.updatedAt?.getTime() ?? 0;
      const daysSilent = Math.floor((now - lastAt) / DAY_MS);
      if (daysSilent < 14) continue;
      const cand: NudgeCandidate = {
        source: 'goal_no_progress',
        significance: 0,
        payload: { goal: g.goalText, daysSilent },
        toneHint: 'curious',
      };
      cand.significance = scoreSignificance(cand);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn('[v2-proactivity] detectGoalNoProgress failed:', err);
    return [];
  }
}

/**
 * v2 Phase B4 — propose a skill when the user repeatedly invokes the same
 * cluster of tools. Reads ToolCall history: groups same-day tool sets,
 * finds a cluster of >=3 distinct tools that recurs on >=3 distinct days.
 * Returns at most one candidate. Best-effort.
 */
export async function detectSkillOpportunity(
  userId: string,
): Promise<NudgeCandidate[]> {
  try {
    const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    const calls = await prisma.toolCall.findMany({
      where: { userId, createdAt: { gte: since }, error: null },
      select: { toolName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    if (calls.length < 9) return [];
    const byDay = new Map<string, Set<string>>();
    for (const c of calls) {
      const day = c.createdAt.toISOString().slice(0, 10);
      const set = byDay.get(day) ?? new Set<string>();
      set.add(c.toolName);
      byDay.set(day, set);
    }
    const dayCount = new Map<string, number>();
    for (const set of byDay.values()) {
      for (const t of set) dayCount.set(t, (dayCount.get(t) ?? 0) + 1);
    }
    const cluster = [...dayCount.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([t]) => t);
    if (cluster.length < 3) return [];
    const recurrence = Math.max(...cluster.map((t) => dayCount.get(t) ?? 0));
    const candidate: NudgeCandidate = {
      source: 'skill_suggestion',
      significance: 0,
      payload: { cluster, clusterSize: cluster.length, recurrence },
      toneHint: 'curious',
    };
    candidate.significance = scoreSignificance(candidate);
    return [candidate];
  } catch (err) {
    console.warn('[v2-proactivity:skill] failed:', err);
    return [];
  }
}

// ---- Gates (A4) -------------------------------------------------------

async function gate1_DND(userId: string, now: Date): Promise<boolean> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, wakeUpTime: true },
    });
    if (!u) return false;
    const hour = localHour(u.timezone, now);
    const wakeUpHour = Number(String(u.wakeUpTime).split(':')[0]) || 7;
    // Quiet: from 22:00 until wakeUpHour the next morning.
    if (hour >= 22 || hour < wakeUpHour) return false;
    return true;
  } catch (err) {
    console.warn('[v2-proactivity] gate1_DND failed:', err);
    return false; // fail-closed: when in doubt, do not nudge
  }
}

async function gate2_RateLimit(userId: string, now: Date): Promise<boolean> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    if (!u) return false;
    const dayStart = localDayStartUTC(u.timezone, now);
    const todayCount = await prisma.insight.count({
      where: {
        userId,
        source: 'v2-proactivity',
        createdAt: { gte: dayStart },
      },
    });
    return todayCount < 2;
  } catch (err) {
    console.warn('[v2-proactivity] gate2_RateLimit failed:', err);
    return false;
  }
}

async function gate4_Dedup(
  userId: string,
  candidate: NudgeCandidate,
  now: Date,
): Promise<boolean> {
  if (!candidate.entityId) return true;
  try {
    const cutoff = new Date(now.getTime() - 7 * DAY_MS);
    const recent = await prisma.insight.findFirst({
      where: {
        userId,
        source: 'v2-proactivity',
        scope: { path: ['entityId'], equals: candidate.entityId },
        createdAt: { gte: cutoff },
      },
      select: { id: true },
    });
    return recent === null;
  } catch (err) {
    console.warn('[v2-proactivity] gate4_Dedup failed:', err);
    return false;
  }
}

// ---- Engine class — placeholders (filled in A2-A6) -----------------------

export class V2ProactivityEngine implements ProactivityEngine {
  async detectCandidates(userId: string): Promise<NudgeCandidate[]> {
    const results = await Promise.allSettled([
      detectStaleEntity(userId),
      detectCommitmentDue(userId),
      detectObligationDue(userId),
      detectDecisionReview(userId),
      detectGoalImpact(userId),
      detectRunwayLow(userId),
      detectEnergyLink(userId),
      detectRelationshipLink(userId),
      detectMoodShift(userId),
      detectStreakBreak(userId),
      detectGoalNoProgress(userId),
      detectIdentityGrowth(userId),
      detectSkillOpportunity(userId),
    ]);
    const out: NudgeCandidate[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') out.push(...r.value);
    }
    return out;
  }

  async runForUser(userId: string): Promise<{
    candidatesFound: number;
    candidatesAfterFilter: number;
    nudgesDelivered: number;
  }> {
    const all = await this.detectCandidates(userId);
    const passed = await this.filterCandidates(userId, all);
    if (passed.length === 0) {
      return {
        candidatesFound: all.length,
        candidatesAfterFilter: 0,
        nudgesDelivered: 0,
      };
    }
    passed.sort((a, b) => b.significance - a.significance);
    const top = passed[0];
    const message = await this.generateNudge(userId, top);
    const scope =
      `${top.source}:${top.entityId ?? top.patternId ?? 'global'}`;
    const candidate: InsightCandidate = {
      kind: 'v2_nudge',
      scope,
      source: 'v2-proactivity' as any,
      severity: Math.round(top.significance * 10),
      message,
      rationale: `v2-proactivity:${top.source}`,
      suggestedAction: {
        entityId: top.entityId,
        patternId: top.patternId,
        payload: top.payload,
        toneHint: top.toneHint,
      },
    };
    try {
      const res = await persistCandidates(userId, [candidate]);
      return {
        candidatesFound: all.length,
        candidatesAfterFilter: passed.length,
        nudgesDelivered: res.created,
      };
    } catch (err) {
      console.warn('[v2-proactivity] persistCandidates failed:', err);
      return {
        candidatesFound: all.length,
        candidatesAfterFilter: passed.length,
        nudgesDelivered: 0,
      };
    }
  }
  async filterCandidates(
    userId: string,
    candidates: NudgeCandidate[],
  ): Promise<NudgeCandidate[]> {
    if (candidates.length === 0) return [];
    const now = new Date();
    // Gate 1 + 2 are user-scoped, shortcircuit early.
    if (!(await gate1_DND(userId, now))) return [];
    if (!(await gate2_RateLimit(userId, now))) return [];
    let sigThreshold = 0.6;
    if (isV2EngagementEnabled(userId)) {
      try {
        const eng = await getEngagement(userId, now);
        sigThreshold = adaptiveThreshold(0.6, eng.receptiveness);
      } catch (err) {
        console.warn('[engagement:gate3] failed:', err);
      }
    }
    const passed: NudgeCandidate[] = [];
    for (const c of candidates) {
      if (!gate3_Significance(c, sigThreshold)) continue;
      if (!(await gate4_Dedup(userId, c, now))) continue;
      passed.push(c);
    }
    return passed;
  }
  async generateNudge(
    userId: string,
    candidate: NudgeCandidate,
  ): Promise<string> {
    // Special case: identity_growth — use growth narrative.
    if (candidate.source === 'identity_growth') {
      try {
        const identity = await getBotIdentityService().getIdentity(userId);
        const payload = candidate.payload as {
          baseline: { warmth: number; directness: number; humor: number; playfulness: number; depth: number; recordedAt: Date };
          current: { warmth: number; directness: number; humor: number; playfulness: number; relationshipDepth: number };
        };
        return await generateGrowthNarrative(
          { ...payload.baseline },
          { ...payload.current, lastComputedAt: null },
          identity.botName,
        );
      } catch {
        return 'Знаешь, я заметила, что мы стали ближе за это время. Мне нравится, какими мы стали.';
      }
    }

    // 1) Template lookup — fast, deterministic, free.
    const template = TEMPLATES[candidate.source]?.[candidate.toneHint];
    if (template) {
      const rendered = interpolate(template, candidate.payload);
      if (rendered.trim().length > 0) return rendered;
    }
    // 2) Claude haiku fallback.
    try {
      const identity = await getBotIdentityService()
        .getIdentity(userId)
        .catch(() => null);
      const botName = identity?.botName ?? 'JARVIS';
      const tone = candidate.toneHint;
      const prompt =
        `Ты — ${botName}, проактивный AI-друг. Сгенерируй ОДНО короткое ` +
        `(1-2 предложения, без markdown, без emoji кроме 🤍) ` +
        `проактивное сообщение пользователю. Tone: ${tone}. ` +
        `Source: ${candidate.source}. Payload: ${JSON.stringify(candidate.payload)}. ` +
        `Не объясняй, не извиняйся — просто сообщение, как другу.`;
      const reply = await runAgent({
        system: prompt,
        userMessage: 'Generate.',
        webSearch: false,
        localTools: false,
        maxTokens: 200,
        userId,
      });
      const txt = (reply ?? '').trim();
      if (txt.length > 0) return txt;
    } catch (err) {
      console.warn('[v2-proactivity] generateNudge claude failed:', err);
    }
    return 'Подумал о тебе — как ты?';
  }
}
