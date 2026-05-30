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
  return lines.join('\n');
}

const DAY_MS = 86_400_000;

export async function fetchV2EnrichmentData(
  userId: string,
): Promise<V2EnrichmentData | null> {
  try {
    const [identity, patterns, moodShift, entityRows] = await Promise.all([
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
    };
  } catch (err) {
    console.warn('[v2-enrichment] fetch failed:', err);
    return null;
  }
}
