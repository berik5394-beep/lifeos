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
