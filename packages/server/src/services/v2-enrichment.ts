/**
 * v2.0 Week 5 D2 — system-prompt enrichment from new memory tiers.
 *
 * Pure builder (buildV2EnrichmentBlock) + async fetcher
 * (fetchV2EnrichmentData). Orchestrator appends the rendered block to
 * the system prompt only when isV2MemoryEnabled — additive, never
 * touches the legacy buildJarvisPrompt output.
 *
 * Block is whitespace-stable: missing data drops the *whole* line so
 * prompt diff stays predictable turn-to-turn.
 */

import { prisma } from '../lib/prisma.js';
import { getBotIdentityService } from './bot-identity.singleton.js';
import { getProceduralMemory } from './procedural-memory.singleton.js';
import { getEmotionalMemory } from './emotional-memory.singleton.js';
import { getUserAxesStore } from './user-axes/index.js';
import { axisLabel, type UserAxesValues } from './user-axes/index.js';
import { isV2AxesEnabled, isV2ObligationsEnabled } from '../lib/feature-flags.js';
import { openObligationsForContext } from './obligations/index.js';
import { getBotTraitsStore } from './bot-traits/index.js';
import { formatToneSection } from './bot-traits/tone-section.js';
import { isV2IdentityEnabled } from '../lib/feature-flags.js';

export type V2EnrichmentData = {
  identity: { botName: string; style: string } | null;
  patterns: Array<{ kind: string; summary: string }>;
  moodShift: {
    shifted: boolean;
    direction?: 'up' | 'down';
    magnitude?: number;
    sinceDays?: number;
  } | null;
  entities: Array<{
    name: string;
    importance: number;
    daysSinceLastSeen: number;
  }>;
  obligations: Array<{
    direction: string;
    personName: string;
    description: string;
    due: string | null;
  }>;
};

export function buildV2EnrichmentBlock(data: V2EnrichmentData): string {
  const lines: string[] = ['[v2-память]'];
  const id = data.identity;
  lines.push(`имя: ${id?.botName ?? 'JARVIS'} (стиль: ${id?.style ?? 'default'})`);
  if (data.patterns.length > 0) {
    const top = data.patterns.slice(0, 3).map((p) => p.summary).join('; ');
    lines.push(`активные паттерны: ${top}`);
  }
  if (data.moodShift?.shifted && data.moodShift?.magnitude !== undefined) {
    const m = data.moodShift;
    const dir = m.direction === 'down' ? '📉' : '📈';
    lines.push(
      `настроение: ${dir} сдвиг ${Number(m.magnitude).toFixed(1)} (${m.sinceDays ?? 0}д)`,
    );
  }
  if (data.entities.length > 0) {
    const top = data.entities
      .slice(0, 5)
      .map(
        (e) =>
          `${e.name} (важн ${e.importance}, виделись ${e.daysSinceLastSeen}д назад)`,
      )
      .join('; ');
    lines.push(`ключевые люди/места: ${top}`);
  }
  const obl = formatObligationsSection(data.obligations);
  if (obl) lines.push(obl);
  return lines.join('\n');
}

/**
 * Pure helper — рендер блока открытых обязательств. Пусто → ''.
 * Exported для юнит-теста.
 */
export function formatObligationsSection(
  rows: Array<{ direction: string; personName: string; description: string; due: string | null }>,
): string {
  if (rows.length === 0) return '';
  const lines = rows.map((o) => {
    const head = o.direction === 'i_owe' ? 'ты должен' : 'тебе должен';
    const due = o.due ? ` (срок ${o.due})` : '';
    return `- ${head} ${o.personName}: ${o.description}${due}`;
  });
  return `обязательства:\n${lines.join('\n')}`;
}

/**
 * v2 Phase B1 — render axes section for system prompt block.
 *
 * Returns empty string when axes are null (e.g. axes feature disabled
 * for user, or first-msg auto-init not yet visible). Otherwise renders
 * 4 lines with current value, semantic label, and behavioural guidance.
 *
 * Pure helper (no I/O) — exported for unit testing.
 */
export function formatAxesSection(axes: UserAxesValues | null): string {
  if (!axes) return '';

  const lines: string[] = ['## Личностные оси (continuous 0..1, обновляются с каждым сообщением)', ''];

  const sd = axes.selfDiscipline;
  lines.push(`- self-discipline: ${sd.toFixed(2)} (${axisLabel(sd)}) — ${guidanceSD(sd)}`);
  const eo = axes.emotionalOpenness;
  lines.push(`- emotional-openness: ${eo.toFixed(2)} (${axisLabel(eo)}) — ${guidanceEO(eo)}`);
  const ct = axes.conflictTolerance;
  lines.push(`- conflict-tolerance: ${ct.toFixed(2)} (${axisLabel(ct)}) — ${guidanceCT(ct)}`);
  const id = axes.introspectionDepth;
  lines.push(`- introspection-depth: ${id.toFixed(2)} (${axisLabel(id)}) — ${guidanceID(id)}`);

  return lines.join('\n');
}

function guidanceSD(v: number): string {
  if (v < 0.3) return 'Юзер борется с follow-through. НЕ предлагай multi-step plans. Помогай через «следующий ОДИН маленький шаг».';
  if (v < 0.6) return 'Умеренная дисциплина. Multi-step OK, но проверяй capacity. Если 3+ шагов — спроси готов ли.';
  if (v < 0.8) return 'Хорошая дисциплина. Можешь предлагать конкретные планы — юзер выполнит.';
  return 'Очень дисциплинированный — можешь поставить ambitious targets, проверять stretch goals.';
}

function guidanceEO(v: number): string {
  if (v < 0.3) return 'Юзер сдержан в эмоциях. Suppress «что чувствуешь?» probes. Фокус на practical help.';
  if (v < 0.6) return 'Умеренная openness. Можешь спрашивать про чувства если context располагает.';
  if (v < 0.8) return 'Открыт обсуждать чувства. Reference past emotional states, can ask "что чувствуешь?".';
  return 'Очень открыт. Можешь suggest journaling, mood inventories, deep emotional reflection.';
}

function guidanceCT(v: number): string {
  if (v < 0.3) return 'Защитен при pushback. Default — supportive. Критику только если ЯВНО попросил. Видишь противоречие — спроси "как ты сам это видишь?".';
  if (v < 0.6) return 'Умеренная tolerance. Pushback OK если мягкий и обоснованный.';
  if (v < 0.8) return 'Открыт challenge. Можешь указать противоречие, holding accountable.';
  return 'Любит правду в лицо. Можешь быть strict trainer, ставить hard questions.';
}

function guidanceID(v: number): string {
  if (v < 0.3) return 'Action-oriented, мало рефлексии. Фокус на конкретике, не открывай philosophical loops.';
  if (v < 0.6) return 'Умеренная reflection. Можешь спрашивать «почему» если на context, но не уходи в abstract.';
  if (v < 0.8) return 'Reflective. Suggest journaling prompts, delve into patterns.';
  return 'Глубокая introspection. Можешь задавать philosophical questions, big-picture reframes.';
}

const DAY_MS = 86_400_000;

export async function fetchV2EnrichmentData(
  userId: string,
): Promise<V2EnrichmentData | null> {
  try {
    const [identity, patterns, moodShift, entityRows, obligationRows] = await Promise.all([
      getBotIdentityService()
        .getIdentity(userId)
        .catch(() => null),
      getProceduralMemory()
        .getActivePatterns(userId, { minConfidence: 0.6 })
        .catch(() => []),
      getEmotionalMemory()
        .detectMoodShift(userId)
        .catch(() => null),
      prisma.entity
        .findMany({
          where: { userId },
          orderBy: [{ importance: 'desc' }, { lastSeenAt: 'desc' }],
          take: 5,
          select: { name: true, importance: true, lastSeenAt: true },
        })
        .catch(() => []),
      isV2ObligationsEnabled(userId)
        ? openObligationsForContext(userId, 5).catch(() => [])
        : Promise.resolve([]),
    ]);
    const now = Date.now();
    return {
      identity: identity
        ? { botName: identity.botName, style: identity.style }
        : null,
      patterns: (patterns ?? []).slice(0, 3).map((p) => {
        const meta = p.payload as Record<string, unknown> | null;
        return {
          kind: p.kind,
          summary: String(
            (meta as Record<string, unknown> | null)?.summary ??
              `${p.kind} (conf ${p.confidence.toFixed(2)})`,
          ),
        };
      }),
      moodShift: moodShift
        ? {
            shifted: moodShift.shifted,
            direction: moodShift.direction,
            magnitude: moodShift.magnitude,
            sinceDays: moodShift.sinceDays,
          }
        : null,
      entities: entityRows.map((e) => ({
        name: e.name,
        importance: e.importance,
        daysSinceLastSeen: Math.max(
          0,
          Math.floor((now - (e.lastSeenAt?.getTime() ?? now)) / DAY_MS),
        ),
      })),
      obligations: obligationRows.map((o) => ({
        direction: o.direction,
        personName: o.personName,
        description: o.description,
        due: o.dueDate ? o.dueDate.toISOString().slice(0, 10) : null,
      })),
    };
  } catch (err) {
    console.warn('[v2-enrichment] fetch failed:', err);
    return null;
  }
}

/**
 * v2 Phase B1 — Fetch axes and render section for enrichment block.
 * Separate helper called by orchestrator after main enrichment data.
 */
export async function fetchV2EnrichmentAxesSection(userId: string): Promise<string> {
  if (!isV2AxesEnabled(userId)) {
    return '';
  }
  try {
    const axes = await getUserAxesStore().getAxes(userId);
    return formatAxesSection(axes);
  } catch (err) {
    console.warn('[v2-enrichment:axes] failed:', err);
    return '';
  }
}

/**
 * v2 Phase B2 — Fetch bot traits and render tone section for enrichment block.
 * Separate helper called by orchestrator after axes section.
 */
export async function fetchV2EnrichmentToneSection(userId: string): Promise<string> {
  if (!isV2IdentityEnabled(userId)) {
    return '';
  }
  try {
    const traits = await getBotTraitsStore().getTraits(userId);
    const msgCount = await prisma.chatMessage.count({ where: { userId } });
    return formatToneSection(traits, msgCount);
  } catch (err) {
    console.warn('[v2-enrichment:tone] failed:', err);
    return '';
  }
}
