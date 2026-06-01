/**
 * v2.0 Tier 4 — ProceduralMemory: statistical pattern extraction.
 *
 * Mini-version (Phase A): no ML, no skill creation. Five statistical
 * extractors operate over Episodic events, Entity table, HabitLog,
 * Memory.embedding (Voyage 512d, already stored Week 3), and recent
 * ChatMessage content. All extractors are best-effort and handle
 * empty data gracefully (new user → no patterns, no throws).
 *
 * Pattern mirrors episodic-memory.ts (Week 2):
 *   - Pure helpers (medianInterval, stddev, clampConfidence, etc.)
 *     exported separately for unit tests without DB.
 *   - Async service methods accept userId + return Prisma rows.
 *   - Class implements interface; singleton accessor in separate file.
 *
 * No wiring to jarvis-orchestrator — Week 5 scope.
 */

import { prisma } from '../lib/prisma.js';
import type { Pattern } from '@prisma/client';
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';

const anthropic = createAnthropic();

// Re-export Prisma type so consumers can import from one place.
export type { Pattern };

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ProceduralMemoryStore {
  extractPatterns(userId: string): Promise<Pattern[]>;
  getActivePatterns(
    userId: string,
    opts?: { kinds?: string[]; minConfidence?: number },
  ): Promise<Pattern[]>;
  hasPattern(userId: string, kind: string, payload: object): Promise<Pattern | null>;
  invalidateStale(userId: string, staleDays?: number): Promise<number>;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB)
// ---------------------------------------------------------------------------

/**
 * Compute median interval in DAYS between consecutive sorted timestamps.
 * Returns 0 if < 2 timestamps (no interval to measure).
 * Input may be unsorted — we sort ascending before computing.
 */
export function medianInterval(timestamps: Date[]): number {
  if (timestamps.length < 2) return 0;
  const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push((sorted[i].getTime() - sorted[i - 1].getTime()) / 86_400_000);
  }
  intervals.sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  return intervals.length % 2 === 0
    ? (intervals[mid - 1] + intervals[mid]) / 2
    : intervals[mid];
}

/**
 * Sample standard deviation (n-1 denominator).
 * Returns 0 for < 2 items.
 */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Map observation count → confidence in [0, 1].
 * Spec: confidence = min(1, observations / 10). Negative → 0.
 */
export function clampConfidence(observations: number): number {
  if (observations <= 0) return 0;
  return Math.min(1, observations / 10);
}

/**
 * Decide whether an interval is "stable enough" to call it a frequency
 * pattern. Stable if median > 0 and sd < threshold * median.
 * Default threshold = 0.5 (spec §6.4 Frequency extractor).
 */
export function isStableInterval(median: number, sd: number, threshold = 0.5): boolean {
  if (median <= 0) return false;
  return sd < threshold * median;
}

/**
 * Compute peak hour and mass within ±windowSize hours.
 * Window wraps modulo 24. Returns peakHour=null for empty input.
 * Deterministic: peak is the hour with highest raw count; ties broken by smaller hour.
 *
 * Used by extractTimeOfDayPatterns. Pure — no DB.
 */
export function hourHistogramWindow(
  hours: number[],
  windowSize = 2,
): { peakHour: number | null; pct: number } {
  if (hours.length === 0) return { peakHour: null, pct: 0 };
  const counts = new Array(24).fill(0) as number[];
  for (const h of hours) {
    const hh = ((h % 24) + 24) % 24;
    counts[Math.floor(hh)]++;
  }

  // Find the hour with the highest raw count (deterministic: ties go to smaller hour).
  let peakHour = 0;
  let peakCount = -1;
  for (let h = 0; h < 24; h++) {
    if (counts[h] > peakCount) {
      peakCount = counts[h];
      peakHour = h;
    }
  }

  // Compute window mass around the peak hour.
  let mass = 0;
  for (let d = -windowSize; d <= windowSize; d++) {
    mass += counts[((peakHour + d) % 24 + 24) % 24];
  }

  return { peakHour, pct: mass / hours.length };
}

/**
 * Standard cosine similarity in [-1, 1]. Returns 0 if either vector
 * is zero or lengths differ.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Greedy single-pass clustering over vectors with cosine threshold.
 * Deterministic: order-dependent (first cluster matched wins).
 * Centroid is running mean of members.
 *
 * Mini-version of k-means/HDBSCAN: faster, no convergence loop, fits
 * Phase A budget (<100 vectors per entity).
 */
export function greedyCluster(
  vectors: number[][],
  threshold = 0.75,
): Array<{ memberIndexes: number[]; centroid: number[] }> {
  const clusters: Array<{ memberIndexes: number[]; centroid: number[] }> = [];
  for (let i = 0; i < vectors.length; i++) {
    const vec = vectors[i];
    let placed = false;
    for (const c of clusters) {
      if (cosineSimilarity(c.centroid, vec) >= threshold) {
        // Add member and update centroid as running mean.
        c.memberIndexes.push(i);
        const n = c.memberIndexes.length;
        for (let d = 0; d < c.centroid.length; d++) {
          c.centroid[d] = c.centroid[d] + (vec[d] - c.centroid[d]) / n;
        }
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ memberIndexes: [i], centroid: [...vec] });
    }
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// ProceduralMemory implementation
// ---------------------------------------------------------------------------

export class ProceduralMemory implements ProceduralMemoryStore {
  async extractPatterns(userId: string): Promise<Pattern[]> {
    const results = await Promise.allSettled([
      extractFrequencyPatterns(userId),
      extractTimeOfDayPatterns(userId),
      extractRecurringTopicPatterns(userId),
      extractCommitmentPatterns(userId),
      extractStreakBreakPatterns(userId),
    ]);

    const aggregated: Pattern[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        aggregated.push(...r.value);
      } else {
        console.warn('[procedural] extractor failed:', r.reason);
      }
    }

    // Dedupe by (kind, JSON.stringify(payload)) — last wins.
    const dedup = new Map<string, Pattern>();
    for (const p of aggregated) {
      const key = `${p.kind}::${JSON.stringify(p.payload)}`;
      dedup.set(key, p);
    }
    return [...dedup.values()];
  }

  async getActivePatterns(
    userId: string,
    opts?: { kinds?: string[]; minConfidence?: number },
  ): Promise<Pattern[]> {
    return prisma.pattern.findMany({
      where: {
        userId,
        invalidAt: null,
        ...(opts?.kinds && opts.kinds.length > 0 ? { kind: { in: opts.kinds } } : {}),
        ...(opts?.minConfidence !== undefined
          ? { confidence: { gte: opts.minConfidence } }
          : {}),
      },
      orderBy: [{ confidence: 'desc' }, { lastObservedAt: 'desc' }],
    });
  }

  async hasPattern(
    userId: string,
    kind: string,
    payload: object,
  ): Promise<Pattern | null> {
    const target = JSON.stringify(payload);
    const candidates = await prisma.pattern.findFirst({
      where: { userId, kind, invalidAt: null },
      orderBy: { lastObservedAt: 'desc' },
    });
    // Fast-path: single candidate compared via JSON.stringify of payload.
    // For mini-version we accept O(N) scan if multiple rows share kind —
    // app-level filter avoids leaning on Prisma JSON path queries.
    if (!candidates) return null;
    if (JSON.stringify(candidates.payload) === target) return candidates;

    // Scan others (rare — most users have <10 patterns per kind).
    const all = await prisma.pattern.findMany({
      where: { userId, kind, invalidAt: null },
    });
    for (const row of all) {
      if (JSON.stringify(row.payload) === target) return row;
    }
    return null;
  }

  async invalidateStale(userId: string, staleDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - staleDays * 86_400_000);
    const result = await prisma.pattern.updateMany({
      where: {
        userId,
        invalidAt: null,
        lastObservedAt: { lt: cutoff },
      },
      data: { invalidAt: new Date() },
    });
    return result.count;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers for extractStreakBreakPatterns (B7)
// ---------------------------------------------------------------------------

/**
 * Index a date into a 1-based week number relative to startDate.
 * Week 1 = startDate .. startDate+6d. Clamps to 1 for dates < startDate.
 */
export function weekIndex(startDate: Date, date: Date): number {
  const ms = date.getTime() - startDate.getTime();
  if (ms < 0) return 1;
  return Math.floor(ms / (7 * 86_400_000)) + 1;
}

// ---------------------------------------------------------------------------
// Pure helpers for extractCommitmentPatterns (B6)
// ---------------------------------------------------------------------------

const COMMITMENT_PHRASES =
  /(обещ[аю]|^|\s)(буду|начн[ёе]?\w*\s+с|решил[аи]?|с\s+понедельника|с\s+завтра|с\s+нового\s+месяца)/i;

/**
 * Cheap regex prefilter for commitment phrases.
 * Mirrors emotional-classifier matchesEmotionalPhrase pattern.
 */
export function matchesCommitmentPhrase(text: string): boolean {
  if (!text) return false;
  if (/обещ[аю]/i.test(text)) return true;
  return COMMITMENT_PHRASES.test(text);
}

/**
 * Parse Claude haiku JSON response into { what, dueAt }.
 * Handles markdown code fences, invalid JSON, missing fields, bad dates.
 * Never throws — returns null on any failure.
 */
export function parseCommitmentResponse(
  raw: string,
): { what: string; dueAt: Date | null } | null {
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  try {
    const parsed = JSON.parse(text) as { what?: unknown; dueAt?: unknown };
    if (typeof parsed.what !== 'string') return null;
    const what = parsed.what.trim();
    if (!what) return null;
    let dueAt: Date | null = null;
    if (typeof parsed.dueAt === 'string' && parsed.dueAt.trim()) {
      const d = new Date(parsed.dueAt);
      if (!Number.isNaN(d.getTime())) dueAt = d;
    }
    return { what, dueAt };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extractor: frequency
// ---------------------------------------------------------------------------

/**
 * For each Entity with importance >= 5, scan related Memory events from
 * the last 60 days. If median inter-event interval is stable
 * (sd < 50% median), upsert a Pattern{kind:'frequency'}.
 *
 * Best-effort: per-entity errors are caught and logged; we never throw.
 */
export async function extractFrequencyPatterns(userId: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const entities = await prisma.entity.findMany({
    where: { userId, importance: { gte: 5 } },
    select: { id: true, name: true },
  });

  if (entities.length === 0) return patterns;

  const cutoff = new Date(Date.now() - 60 * 86_400_000);

  for (const entity of entities) {
    try {
      // Memory.entityRefs is a String[] — use has filter.
      const events = await prisma.memory.findMany({
        where: {
          userId,
          validAt: { gte: cutoff },
          entityRefs: { has: entity.id },
        },
        select: { validAt: true },
        orderBy: { validAt: 'asc' },
      });

      if (events.length < 3) continue; // not enough observations

      const ts = events.map((e) => e.validAt);
      const median = medianInterval(ts);
      const intervals: number[] = [];
      for (let i = 1; i < ts.length; i++) {
        intervals.push((ts[i].getTime() - ts[i - 1].getTime()) / 86_400_000);
      }
      const sd = stddev(intervals);

      if (!isStableInterval(median, sd)) continue;

      const observations = events.length;
      const confidence = clampConfidence(observations);
      const lastObservedAt = ts[ts.length - 1];
      const payload = {
        entityId: entity.id,
        periodDays: Math.round(median * 10) / 10,
        lastObservedAt: lastObservedAt.toISOString(),
      };
      const description = `упоминает ${entity.name} каждые ~${payload.periodDays} дней`;

      // Upsert: look for existing active pattern with same kind+entityId.
      const existing = await prisma.pattern.findFirst({
        where: { userId, kind: 'frequency', invalidAt: null },
      });

      let row: Pattern;
      if (
        existing &&
        (existing.payload as { entityId?: string })?.entityId === entity.id
      ) {
        row = await prisma.pattern.update({
          where: { id: existing.id },
          data: {
            description,
            payload,
            observations,
            confidence,
            lastObservedAt,
          },
        });
      } else {
        row = await prisma.pattern.create({
          data: {
            userId,
            kind: 'frequency',
            description,
            payload,
            observations,
            confidence,
            lastObservedAt,
          },
        });
      }
      patterns.push(row);
    } catch (err) {
      console.warn(
        '[procedural] frequency extract failed for entity',
        entity.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Extractor: time_of_day
// ---------------------------------------------------------------------------

/**
 * For each Habit with >= 14 completed logs, compute hour-of-day histogram
 * over (a) HabitLog.date interpreted at the log-time hour if available,
 * (b) Memory events of type='habit_completed' with validAt as wall-clock.
 *
 * Mini-version note: HabitLog.date is @db.Date (no time component) — we
 * fall back to Memory rows where habit completion has a real timestamp.
 * If neither source yields meaningful hour variance, skip this habit.
 *
 * If >=70% of completions fall within ±2h window → Pattern{time_of_day}.
 * Best-effort: per-habit errors are caught.
 */
export async function extractTimeOfDayPatterns(userId: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const habits = await prisma.habit.findMany({
    where: { userId, active: true },
    select: { id: true, name: true },
  });

  if (habits.length === 0) return patterns;

  for (const habit of habits) {
    try {
      // Source: Memory rows tagged with habit id in entityRefs OR sourceId.
      const memRows = await prisma.memory.findMany({
        where: {
          userId,
          OR: [
            { entityRefs: { has: habit.id } },
            { sourceId: habit.id },
          ],
          type: { in: ['habit_completed', 'event'] },
        },
        select: { validAt: true },
      });

      const hours = memRows.map((r) => r.validAt.getHours());
      if (hours.length < 14) continue;

      const { peakHour, pct } = hourHistogramWindow(hours, 2);
      if (peakHour === null || pct < 0.7) continue;

      const observations = hours.length;
      const confidence = clampConfidence(observations);
      const payload = { habitId: habit.id, hourMode: peakHour, windowPct: pct };
      const description = `${habit.name} обычно в ${peakHour}:00 (±2ч)`;

      const existing = await prisma.pattern.findFirst({
        where: { userId, kind: 'time_of_day', invalidAt: null },
      });

      let row: Pattern;
      if (
        existing &&
        (existing.payload as { habitId?: string })?.habitId === habit.id
      ) {
        row = await prisma.pattern.update({
          where: { id: existing.id },
          data: {
            description,
            payload,
            observations,
            confidence,
            lastObservedAt: new Date(),
          },
        });
      } else {
        row = await prisma.pattern.create({
          data: {
            userId,
            kind: 'time_of_day',
            description,
            payload,
            observations,
            confidence,
            lastObservedAt: new Date(),
          },
        });
      }
      patterns.push(row);
    } catch (err) {
      console.warn(
        '[procedural] time_of_day extract failed for habit',
        habit.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Extractor: recurring_topic (greedy cosine clustering)
// ---------------------------------------------------------------------------

type EmbRow = { id: string; content: string; validAt: Date; embedding: number[] | null };

/**
 * For each Entity with importance >= 7 and >1 event/week baseline, cluster
 * the entity's recent Memory.embedding rows with greedy cosine (threshold
 * 0.75). Any cluster of size >= 3 → Pattern{recurring_topic}.
 *
 * Mini-version: no k-means/HDBSCAN. Best-effort: per-entity errors caught.
 */
export async function extractRecurringTopicPatterns(userId: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const entities = await prisma.entity.findMany({
    where: { userId, importance: { gte: 7 } },
    select: { id: true, name: true, createdAt: true },
  });

  if (entities.length === 0) return patterns;

  const cutoff = new Date(Date.now() - 90 * 86_400_000);

  for (const entity of entities) {
    try {
      // Baseline frequency check: events / weeks-active. Skip if < 1/week.
      const totalEvents = await prisma.memory.count({
        where: { userId, entityRefs: { has: entity.id } },
      });
      const weeksActive = Math.max(
        1,
        (Date.now() - entity.createdAt.getTime()) / (7 * 86_400_000),
      );
      if (totalEvents / weeksActive < 1) continue;

      // Pull embeddings via raw SQL (pgvector type is Unsupported in Prisma).
      const rows = await prisma.$queryRawUnsafe<EmbRow[]>(
        `SELECT id, content, "validAt", embedding::text AS embedding
         FROM "Memory"
         WHERE "userId" = $1
           AND $2 = ANY("entityRefs")
           AND "validAt" >= $3
           AND embedding IS NOT NULL
         ORDER BY "validAt" DESC
         LIMIT 100`,
        userId,
        entity.id,
        cutoff,
      );

      if (rows.length < 3) continue;

      const parsedVectors: number[][] = [];
      const meta: Array<{ id: string; content: string }> = [];
      for (const r of rows) {
        const raw = r.embedding as unknown as string | null;
        if (!raw || typeof raw !== 'string') continue;
        // pgvector text format: "[0.1,0.2,...]"
        try {
          const vec = raw
            .replace(/^\[/, '')
            .replace(/\]$/, '')
            .split(',')
            .map((s) => Number(s.trim()));
          if (vec.length === 0 || vec.some((v) => Number.isNaN(v))) continue;
          parsedVectors.push(vec);
          meta.push({ id: r.id, content: r.content });
        } catch {
          continue;
        }
      }

      if (parsedVectors.length < 3) continue;

      const clusters = greedyCluster(parsedVectors, 0.75);

      for (let ci = 0; ci < clusters.length; ci++) {
        const c = clusters[ci];
        // Require cluster size >= 3 (spec §6.4)
        if (!(c.memberIndexes.length >= 3)) continue;

        const observations = c.memberIndexes.length;
        const confidence = clampConfidence(observations);
        const sampleContents = c.memberIndexes
          .slice(0, 2)
          .map((i) => meta[i].content.slice(0, 120));

        const payload = {
          entityId: entity.id,
          clusterIndex: ci,
          centroidPreview: c.centroid.slice(0, 8),
          size: observations,
          sampleContents,
        };
        const description = `повторяющаяся тема вокруг ${entity.name} (${observations} событий)`;

        const existing = await prisma.pattern.findFirst({
          where: { userId, kind: 'recurring_topic', invalidAt: null },
        });

        let row: Pattern;
        if (
          existing &&
          (existing.payload as { entityId?: string; clusterIndex?: number })?.entityId ===
            entity.id &&
          (existing.payload as { clusterIndex?: number })?.clusterIndex === ci
        ) {
          row = await prisma.pattern.update({
            where: { id: existing.id },
            data: {
              description,
              payload,
              observations,
              confidence,
              lastObservedAt: new Date(),
            },
          });
        } else {
          row = await prisma.pattern.create({
            data: {
              userId,
              kind: 'recurring_topic',
              description,
              payload,
              observations,
              confidence,
              lastObservedAt: new Date(),
            },
          });
        }
        patterns.push(row);
      }
    } catch (err) {
      console.warn(
        '[procedural] recurring_topic extract failed for entity',
        entity.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Extractor: commitment (Claude haiku, regex prefilter)
// ---------------------------------------------------------------------------

const COMMITMENT_SYSTEM_PROMPT = `Ты — аналитик намерений. Из сообщения извлеки ОДНО конкретное обязательство пользователя (что он обещает/решает делать) и срок если есть.

Верни ТОЛЬКО валидный JSON без markdown:
{ "what": "краткое описание обязательства", "dueAt": "ISO-8601 дата или null" }

Если обязательство не явное — верни { "what": "", "dueAt": null }.
НЕ добавляй объяснений, только JSON.`;

export async function extractCommitmentPatterns(userId: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  const messages = await prisma.chatMessage.findMany({
    where: {
      userId,
      role: 'user',
      crisis: false,
      createdAt: { gte: cutoff },
    },
    select: { id: true, content: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  if (messages.length === 0) return patterns;

  for (const msg of messages) {
    if (!matchesCommitmentPhrase(msg.content)) continue;

    try {
      const resp = await anthropic.messages.create({
        model: MODELS.haiku,
        max_tokens: 256,
        system: COMMITMENT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: msg.content.slice(0, 1000) }],
      });
      const block = resp.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text') continue;

      const parsed = parseCommitmentResponse(block.text);
      if (!parsed) continue;

      const payload = {
        what: parsed.what,
        dueAt: parsed.dueAt ? parsed.dueAt.toISOString() : null,
        fulfilled: null,
        sourceMsgId: msg.id,
      };
      const description = `обязательство: ${parsed.what}`;

      // Idempotent on sourceMsgId — same message shouldn't create duplicate.
      const existing = await prisma.pattern.findFirst({
        where: { userId, kind: 'commitment', invalidAt: null },
      });
      let row: Pattern;
      if (
        existing &&
        (existing.payload as { sourceMsgId?: string })?.sourceMsgId === msg.id
      ) {
        row = existing;
      } else {
        row = await prisma.pattern.create({
          data: {
            userId,
            kind: 'commitment',
            description,
            payload,
            observations: 1,
            confidence: 1.0,
            lastObservedAt: msg.createdAt,
          },
        });
      }
      patterns.push(row);
    } catch (err) {
      console.warn(
        '[procedural] commitment extract failed for msg',
        msg.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Extractor: streak_break
// ---------------------------------------------------------------------------

/**
 * For each Habit with >= 42 logs (6 weeks), bucket logs by week index.
 * Find weeks where completion rate < 30% that immediately followed a
 * streak week (>= 80%). If same week-of-streak repeats as break >= 2
 * times → Pattern{streak_break}.
 *
 * Best-effort: per-habit errors caught.
 */
export async function extractStreakBreakPatterns(userId: string): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const habits = await prisma.habit.findMany({
    where: { userId, active: true },
    select: { id: true, name: true, createdAt: true },
  });

  if (habits.length === 0) return patterns;

  for (const habit of habits) {
    try {
      const logs = await prisma.habitLog.findMany({
        where: { habitId: habit.id, userId },
        select: { date: true, completed: true },
        orderBy: { date: 'asc' },
      });

      if (logs.length < 42) continue;

      // Bucket by week index. weekStats[wi] = { total, completed }
      const weekStats = new Map<number, { total: number; completed: number }>();
      for (const log of logs) {
        const wi = weekIndex(habit.createdAt, log.date);
        const entry = weekStats.get(wi) ?? { total: 0, completed: 0 };
        entry.total++;
        if (log.completed) entry.completed++;
        weekStats.set(wi, entry);
      }

      // Sort weeks ascending; find break weeks that follow streak weeks.
      const sortedWeeks = [...weekStats.entries()].sort((a, b) => a[0] - b[0]);
      const breakOccurrencesByWeek = new Map<number, number>();
      for (let i = 1; i < sortedWeeks.length; i++) {
        const [, prev] = sortedWeeks[i - 1];
        const [wi, curr] = sortedWeeks[i];
        const prevRate = prev.total === 0 ? 0 : prev.completed / prev.total;
        const currRate = curr.total === 0 ? 0 : curr.completed / curr.total;
        if (prevRate >= 0.8 && currRate < 0.3) {
          breakOccurrencesByWeek.set(wi, (breakOccurrencesByWeek.get(wi) ?? 0) + 1);
        }
      }

      for (const [wi, count] of breakOccurrencesByWeek.entries()) {
        if (count < 2) continue; // need >= 2 same-week breaks

        const observations = count;
        const confidence = clampConfidence(observations * 5); // 2 breaks → 1.0
        const payload = {
          habitId: habit.id,
          weekNumber: wi,
          observedAt: new Date().toISOString(),
        };
        const description = `${habit.name}: бросает на ${wi}-й неделе streak'а`;

        const existing = await prisma.pattern.findFirst({
          where: { userId, kind: 'streak_break', invalidAt: null },
        });
        let row: Pattern;
        if (
          existing &&
          (existing.payload as { habitId?: string; weekNumber?: number })?.habitId ===
            habit.id &&
          (existing.payload as { weekNumber?: number })?.weekNumber === wi
        ) {
          row = await prisma.pattern.update({
            where: { id: existing.id },
            data: {
              description,
              payload,
              observations,
              confidence,
              lastObservedAt: new Date(),
            },
          });
        } else {
          row = await prisma.pattern.create({
            data: {
              userId,
              kind: 'streak_break',
              description,
              payload,
              observations,
              confidence,
              lastObservedAt: new Date(),
            },
          });
        }
        patterns.push(row);
      }
    } catch (err) {
      console.warn(
        '[procedural] streak_break extract failed for habit',
        habit.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return patterns;
}

// Reference prisma to prevent unused-import lint (will be used in B2+).
void prisma;
