/**
 * v2.0 Week 5 — Proactivity Engine.
 *
 * Single source of truth for outbound proactive nudges based on the new
 * memory tiers (semantic / episodic / procedural / emotional). Runs per
 * scheduler tick (every 10 min, behind FEATURE_V2_PROACTIVITY flag).
 *
 * Flow: runForUser → detectCandidates (5 detectors) → filterCandidates
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
  | 'goal_no_progress';

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
};

// ---- Detectors (A2-A3) -------------------------------------------------------

import { getEntityGraph } from './entity-graph/index.js';
import { getProceduralMemory } from './procedural-memory.singleton.js';
import { lastEventForEntity } from './episodic-memory.js';
import { getEmotionalMemory } from './emotional-memory.singleton.js';
import { prisma } from '../lib/prisma.js';
import { localDayStartUTC, localHour } from '../lib/tz.js';
import { runAgent } from './claude-agent.js';
import { getBotIdentityService } from './bot-identity.singleton.js';
import { persistCandidates } from './insight-store.js';
import type { InsightCandidate } from './insight-core.js';

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
      detectMoodShift(userId),
      detectStreakBreak(userId),
      detectGoalNoProgress(userId),
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
    const passed: NudgeCandidate[] = [];
    for (const c of candidates) {
      if (!gate3_Significance(c)) continue;
      if (!(await gate4_Dedup(userId, c, now))) continue;
      passed.push(c);
    }
    return passed;
  }
  async generateNudge(
    userId: string,
    candidate: NudgeCandidate,
  ): Promise<string> {
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
