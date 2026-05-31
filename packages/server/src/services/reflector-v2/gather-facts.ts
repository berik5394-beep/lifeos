/**
 * Reflector v2 — best-effort cross-tier fact gathering. Each tier read is
 * isolated: a failure omits only that field. `legacy` is always present
 * (computed inline). Never throws.
 */

import { prisma } from '../../lib/prisma.js';
import { getUserAxesStore } from '../user-axes/index.js';
import { getBotTraitsStore } from '../bot-traits/index.js';
import { getFeedbackStore } from '../feedback/index.js';
import { getEmotionalMemory } from '../emotional-memory.singleton.js';
import { getHermesStore } from '../hermes/index.js';
import { getEntityGraph } from '../entity-graph/index.js';
import { getProceduralMemory } from '../procedural-memory.singleton.js';
import type { ReflectorV2Facts } from './types.js';

const DAY = 24 * 60 * 60 * 1000;

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[reflector-v2:gather:${label}] failed:`,
      err instanceof Error ? err.message : err);
    return undefined;
  }
}

async function computeLegacy(userId: string, now: Date): Promise<ReflectorV2Facts['legacy']> {
  const since30 = new Date(now.getTime() - 30 * DAY);
  try {
    const [income, expense, habitLogs, habits, staleTasks, budgets] = await Promise.all([
      prisma.income.aggregate({ _sum: { amount: true }, where: { userId, date: { gte: since30 } } }),
      prisma.expense.aggregate({ _sum: { amount: true }, where: { userId, date: { gte: since30 } } }),
      prisma.habitLog.count({ where: { userId, date: { gte: since30 }, completed: true } }),
      prisma.habit.count({ where: { userId, active: true } }),
      prisma.task.count({ where: { userId, completed: false, date: { lt: new Date(now.getTime() - 2 * DAY) } } }),
      prisma.budgetLimit.aggregate({ _sum: { monthlyLimit: true }, where: { userId, month: now.getUTCMonth() + 1, year: now.getUTCFullYear() } }),
    ]);
    const monthlyIncome = income._sum.amount ?? 0;
    const monthlyBurn = expense._sum.amount ?? 0;
    const denom = Math.max(1, (habits || 1) * 30);
    const habitConsistency = Math.max(0, Math.min(1, habitLogs / denom));
    const limit = budgets._sum.monthlyLimit ?? 0;
    const budgetPct = limit > 0 ? monthlyBurn / limit : 0;
    return {
      monthlyBurn, monthlyIncome, habitConsistency,
      goalsBehind: 0, tasksStale: staleTasks, budgetPct,
    };
  } catch (err) {
    console.warn('[reflector-v2:gather:legacy] failed:', err);
    return { monthlyBurn: 0, monthlyIncome: 0, habitConsistency: 1, goalsBehind: 0, tasksStale: 0, budgetPct: 0 };
  }
}

export async function gatherFacts(userId: string, now: Date = new Date()): Promise<ReflectorV2Facts> {
  const legacy = await computeLegacy(userId, now);

  const axesRaw = await safe('axes', () => getUserAxesStore().getAxes(userId));
  const axes = axesRaw ? {
    selfDiscipline: axesRaw.selfDiscipline,
    emotionalOpenness: axesRaw.emotionalOpenness,
    conflictTolerance: axesRaw.conflictTolerance,
    introspectionDepth: axesRaw.introspectionDepth,
  } : null;

  const traitsRaw = await safe('traits', () => getBotTraitsStore().getTraits(userId));
  const traits = traitsRaw ? {
    warmth: traitsRaw.warmth, directness: traitsRaw.directness,
    humor: traitsRaw.humor, playfulness: traitsRaw.playfulness,
    relationshipDepth: traitsRaw.relationshipDepth,
  } : null;

  const emo = getEmotionalMemory();
  const timeline = await safe('mood', () => emo.getMoodTimeline(userId, 14));
  const shift = await safe('moodShift', () => emo.detectMoodShift(userId));
  let moodTrend: ReflectorV2Facts['moodTrend'] = null;
  if (timeline && timeline.length > 0) {
    const recent = timeline.slice(-7);
    const prior = timeline.slice(0, Math.max(0, timeline.length - 7));
    const avg = (a: Array<{ valence: number }>) =>
      a.length ? a.reduce((s, x) => s + x.valence, 0) / a.length : 0;
    const current = avg(recent);
    const deltaWeek = current - (prior.length ? avg(prior) : current);
    moodTrend = { current, deltaWeek, shift: !!(shift && shift.shifted) };
  }

  const corrections = await safe('feedback', () => getFeedbackStore().recentCorrections(userId, 5));
  const recentCorrections = (corrections ?? []).map((c) => ({
    styleNote: c.styleNote, dimension: c.dimension,
  }));

  const skillRows = await safe('skills', () => getHermesStore().listSkills(userId));
  const skills = (skillRows ?? []).map((s) => ({ name: s.name, useCount: s.useCount }));

  const stale = await safe('entities', () => getEntityGraph().staleEntities(userId, 30, 5));
  const staleEntities = (stale ?? []).slice(0, 5).map((e) => ({
    name: e.name, type: e.type,
    gapDays: e.lastSeenAt ? Math.round((now.getTime() - new Date(e.lastSeenAt).getTime()) / DAY) : 0,
  }));

  const patternRows = await safe('patterns', () => getProceduralMemory().getActivePatterns(userId));
  const patterns = (patternRows ?? []).slice(0, 5).map((p) => ({
    kind: p.kind,
    // Pattern model has `description` (not `summary`) — map to the required field name
    summary: p.description ?? p.kind,
  }));

  return { axes, traits, moodTrend, recentCorrections, skills, staleEntities, patterns, legacy };
}
