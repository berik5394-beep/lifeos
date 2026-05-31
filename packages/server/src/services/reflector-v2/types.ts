/**
 * Reflector v2 — cross-tier synthesis types + pure helpers.
 * Spec: docs/superpowers/specs/2026-05-31-v2-reflector-v2-design.md
 *
 * Pure helpers (significanceScore, shouldFireEvent, summariseFactsForPrompt,
 * parseKeystone) are exported for unit testing without DB/Claude.
 */

export interface ReflectorV2Facts {
  axes?: {
    selfDiscipline: number; emotionalOpenness: number;
    conflictTolerance: number; introspectionDepth: number;
  } | null;
  traits?: {
    warmth: number; directness: number; humor: number;
    playfulness: number; relationshipDepth: number;
  } | null;
  moodTrend?: { current: number; deltaWeek: number; shift: boolean } | null;
  recentCorrections?: Array<{ styleNote: string | null; dimension: string }>;
  skills?: Array<{ name: string; useCount: number }>;
  staleEntities?: Array<{ name: string; type: string; gapDays: number }>;
  patterns?: Array<{ kind: string; summary: string }>;
  legacy: {
    monthlyBurn: number; monthlyIncome: number; habitConsistency: number;
    goalsBehind: number; tasksStale: number; budgetPct: number;
  };
}

export interface Keystone {
  message: string;
  rationale: string;
  severity: number;       // 1..10
  scopeTheme: string;     // 'finance'|'health'|'habits'|'goals'|'identity'|'social'|'general'
  suggestedAction?: unknown;
}

export const EVENT_THRESHOLD = 0.6;

const clamp01 = (n: number): number =>
  Number.isNaN(n) ? 0 : Math.max(0, Math.min(1, n));

/**
 * Cross-tier significance for the EVENT trigger, 0..1. Rewards COMPOUND
 * negative signals — multiple tiers pointing the same bad direction.
 */
export function significanceScore(f: ReflectorV2Facts): number {
  const moodDrop = f.moodTrend ? clamp01(-(f.moodTrend.deltaWeek)) : 0;
  const habitGap = clamp01(1 - (f.legacy.habitConsistency ?? 1));
  const budget = clamp01((((f.legacy.budgetPct ?? 0) - 0.8) / 0.2));
  const goals = clamp01((f.legacy.goalsBehind ?? 0) / 3);
  const tasks = clamp01((f.legacy.tasksStale ?? 0) / 5);
  const score =
    0.30 * moodDrop + 0.25 * habitGap + 0.20 * budget +
    0.15 * goals + 0.10 * tasks;
  return clamp01(score);
}

export function shouldFireEvent(f: ReflectorV2Facts): boolean {
  return significanceScore(f) >= EVENT_THRESHOLD;
}

/** Compact, human-readable fact block for the synthesis prompt. Omits
 *  absent tiers so the model isn't told about data we don't have. */
export function summariseFactsForPrompt(f: ReflectorV2Facts): string {
  const lines: string[] = [];
  if (f.axes) {
    lines.push(
      `Личность(axes): self-discipline=${f.axes.selfDiscipline.toFixed(2)}, ` +
      `emotional-openness=${f.axes.emotionalOpenness.toFixed(2)}, ` +
      `conflict-tolerance=${f.axes.conflictTolerance.toFixed(2)}, ` +
      `introspection=${f.axes.introspectionDepth.toFixed(2)}`,
    );
  }
  if (f.traits) {
    lines.push(
      `Тон бота(traits): warmth=${f.traits.warmth.toFixed(2)}, ` +
      `directness=${f.traits.directness.toFixed(2)}, depth=${f.traits.relationshipDepth.toFixed(2)}`,
    );
  }
  if (f.moodTrend) {
    lines.push(
      `Настроение: текущее=${f.moodTrend.current.toFixed(2)}, ` +
      `Δнеделя=${f.moodTrend.deltaWeek.toFixed(2)}${f.moodTrend.shift ? ' (сдвиг!)' : ''}`,
    );
  }
  if (f.recentCorrections && f.recentCorrections.length) {
    const notes = f.recentCorrections
      .map((c) => c.styleNote).filter(Boolean).slice(0, 3).join('; ');
    if (notes) lines.push(`Недавние коррекции стиля: ${notes}`);
  }
  if (f.skills && f.skills.length) {
    lines.push(`Навыки: ${f.skills.map((s) => `${s.name}(${s.useCount})`).slice(0, 5).join(', ')}`);
  }
  if (f.staleEntities && f.staleEntities.length) {
    lines.push(`Заброшенные связи: ${f.staleEntities.map((e) => `${e.name}(${e.gapDays}д)`).slice(0, 3).join(', ')}`);
  }
  if (f.patterns && f.patterns.length) {
    lines.push(`Паттерны: ${f.patterns.map((p) => p.summary).slice(0, 3).join('; ')}`);
  }
  lines.push(
    `Жизнь: доход/мес=${Math.round(f.legacy.monthlyIncome)}, ` +
    `трата/мес=${Math.round(f.legacy.monthlyBurn)}, ` +
    `привычки=${(f.legacy.habitConsistency * 100).toFixed(0)}%, ` +
    `целей-позади=${f.legacy.goalsBehind}, задач-просрочено=${f.legacy.tasksStale}, ` +
    `бюджет=${(f.legacy.budgetPct * 100).toFixed(0)}%`,
  );
  return lines.join('\n');
}

const THEMES: ReadonlySet<string> = new Set([
  'finance', 'health', 'habits', 'goals', 'identity', 'social', 'general',
]);

/** Defensive parser for the sonnet keystone JSON. Never throws → null. */
export function parseKeystone(raw: string): Keystone | null {
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.message !== 'string' || typeof o.rationale !== 'string') return null;
  if (typeof o.severity !== 'number') return null;
  const severity = Math.max(1, Math.min(10, Math.round(o.severity)));
  const scopeTheme =
    typeof o.scopeTheme === 'string' && THEMES.has(o.scopeTheme)
      ? o.scopeTheme : 'general';
  return {
    message: o.message.slice(0, 1000),
    rationale: o.rationale.slice(0, 280),
    severity,
    scopeTheme,
    suggestedAction: o.suggestedAction ?? null,
  };
}
