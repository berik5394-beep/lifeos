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

// ---- Engine class — placeholders (filled in A2-A6) -----------------------

export class V2ProactivityEngine implements ProactivityEngine {
  async runForUser(_userId: string): Promise<{
    candidatesFound: number;
    candidatesAfterFilter: number;
    nudgesDelivered: number;
  }> {
    throw new Error('not yet implemented — Task A6');
  }
  async detectCandidates(_userId: string): Promise<NudgeCandidate[]> {
    throw new Error('not yet implemented — Task A2/A3');
  }
  async filterCandidates(
    _userId: string,
    _candidates: NudgeCandidate[],
  ): Promise<NudgeCandidate[]> {
    throw new Error('not yet implemented — Task A4');
  }
  async generateNudge(
    _userId: string,
    _candidate: NudgeCandidate,
  ): Promise<string> {
    throw new Error('not yet implemented — Task A5');
  }
}
