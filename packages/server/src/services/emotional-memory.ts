/**
 * v2.0 Tier 5 — EmotionalMemory: structured mood per message + timeline.
 *
 * NEW module — does NOT replace existing emotional-classifier.ts
 * (binary phrase-net for therapeutic routing). This module extracts a
 * structured {valence, arousal, emotion} JSON via Claude haiku and writes
 * MoodSnapshot rows for timeline analytics + entity-mood + shift detection.
 *
 * Pattern mirrors episodic-memory.ts:
 *   - Pure helpers exported for unit testing without DB/Claude
 *   - Async service methods on a class implementing EmotionalMemoryStore
 *   - Singleton accessor in separate file
 *
 * Best-effort throughout: Claude failures yield safe default
 * { valence: 0, arousal: 0.5, emotion: 'neutral' } and never throw.
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma.js';
import { MODELS } from '../lib/models.js';
import type { MoodSnapshot } from '@prisma/client';

export type { MoodSnapshot };

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EmotionalMemoryStore {
  analyzeMessage(userId: string, msgId: string, content: string): Promise<MoodSnapshot>;
  getMoodTimeline(
    userId: string,
    sinceDays: number,
  ): Promise<Array<{ date: string; valence: number; emotion: string }>>;
  getEntityMood(userId: string, entityId: string): Promise<number>;
  detectMoodShift(userId: string): Promise<{
    shifted: boolean;
    direction?: 'up' | 'down';
    magnitude?: number;
    sinceDays?: number;
  } | null>;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB/Claude)
// ---------------------------------------------------------------------------

const KNOWN_EMOTIONS = new Set([
  'sad', 'anxious', 'happy', 'angry', 'neutral', 'mixed',
]);

export function clampValence(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

export function clampArousal(a: number): number {
  if (Number.isNaN(a)) return 0.5;
  return Math.max(0, Math.min(1, a));
}

export function normalizeEmotionLabel(
  raw: string,
): 'sad' | 'anxious' | 'happy' | 'angry' | 'neutral' | 'mixed' {
  if (!raw || typeof raw !== 'string') return 'neutral';
  const lower = raw.trim().toLowerCase();
  return (KNOWN_EMOTIONS.has(lower) ? lower : 'neutral') as
    | 'sad' | 'anxious' | 'happy' | 'angry' | 'neutral' | 'mixed';
}

/**
 * Parse Claude mood response. Never throws — safe default on any failure:
 *   { valence: 0, arousal: 0.5, emotion: 'neutral' }
 */
export function parseMoodResponse(
  raw: string,
): { valence: number; arousal: number; emotion: string } {
  const safe = { valence: 0, arousal: 0.5, emotion: 'neutral' };
  if (!raw || !raw.trim()) return safe;
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  try {
    const parsed = JSON.parse(text) as {
      valence?: unknown;
      arousal?: unknown;
      emotion?: unknown;
    };
    const valence =
      typeof parsed.valence === 'number' ? clampValence(parsed.valence) : 0;
    const arousal =
      typeof parsed.arousal === 'number' ? clampArousal(parsed.arousal) : 0.5;
    const emotion = normalizeEmotionLabel(
      typeof parsed.emotion === 'string' ? parsed.emotion : 'neutral',
    );
    return { valence, arousal, emotion };
  } catch {
    return safe;
  }
}

/**
 * Return the most common string in `list`. Ties broken alphabetically.
 * Empty list → 'neutral'.
 */
export function dominantEmotion(list: string[]): string {
  if (list.length === 0) return 'neutral';
  const counts = new Map<string, number>();
  for (const e of list) counts.set(e, (counts.get(e) ?? 0) + 1);
  let best = '';
  let bestCount = -1;
  for (const [emo, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (c > bestCount) {
      best = emo;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Group mood snapshots by UTC day. For each day returns avg valence
 * and dominant emotion. Result sorted ascending by date.
 */
export function groupByDay(
  snaps: Array<{ recordedAt: Date; valence: number; emotion: string }>,
): Array<{ date: string; valence: number; emotion: string }> {
  if (snaps.length === 0) return [];
  const byDay = new Map<string, { valences: number[]; emotions: string[] }>();
  for (const s of snaps) {
    const key = s.recordedAt.toISOString().slice(0, 10);
    const entry = byDay.get(key) ?? { valences: [], emotions: [] };
    entry.valences.push(s.valence);
    entry.emotions.push(s.emotion);
    byDay.set(key, entry);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, { valences, emotions }]) => ({
      date,
      valence: valences.reduce((s, v) => s + v, 0) / valences.length,
      emotion: dominantEmotion(emotions),
    }));
}

// ---------------------------------------------------------------------------
// EmotionalMemory implementation
// ---------------------------------------------------------------------------

const MOOD_SYSTEM_PROMPT = `Ты — анализатор эмоций. Прочитай сообщение пользователя и оцени:
- valence: -1..+1 (негативная — позитивная окраска)
- arousal: 0..1 (спокойствие — возбуждение)
- emotion: одно из 'sad'|'anxious'|'happy'|'angry'|'neutral'|'mixed'

Верни ТОЛЬКО валидный JSON без markdown:
{ "valence": 0.0, "arousal": 0.5, "emotion": "neutral" }

НЕ добавляй объяснений.`;

export class EmotionalMemory implements EmotionalMemoryStore {
  async analyzeMessage(
    userId: string,
    msgId: string,
    content: string,
  ): Promise<MoodSnapshot> {
    let parsed = { valence: 0, arousal: 0.5, emotion: 'neutral' };

    try {
      const resp = await anthropic.messages.create({
        model: MODELS.haiku,
        max_tokens: 128,
        system: MOOD_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: content.slice(0, 1000) }],
      });
      const block = resp.content.find((b) => b.type === 'text');
      if (block && block.type === 'text') {
        parsed = parseMoodResponse(block.text);
      }
    } catch (err) {
      console.warn(
        '[emotional-memory] analyzeMessage Claude failed (fallback to neutral):',
        err instanceof Error ? err.message : err,
      );
      // parsed stays at safe default
    }

    return prisma.moodSnapshot.create({
      data: {
        userId,
        source: 'message',
        sourceId: msgId,
        valence: parsed.valence,
        arousal: parsed.arousal,
        emotion: parsed.emotion,
        entityRefs: [],
        excerpt: content.slice(0, 200),
      },
    });
  }

  async getMoodTimeline(
    userId: string,
    sinceDays: number,
  ): Promise<Array<{ date: string; valence: number; emotion: string }>> {
    const cutoff = new Date(Date.now() - sinceDays * 86_400_000);
    const rows = await prisma.moodSnapshot.findMany({
      where: { userId, source: 'message', recordedAt: { gte: cutoff } },
      select: { recordedAt: true, valence: true, emotion: true },
      orderBy: { recordedAt: 'asc' },
    });
    return groupByDay(rows);
  }

  async getEntityMood(userId: string, entityId: string): Promise<number> {
    const rows = await prisma.moodSnapshot.findMany({
      where: { userId, entityRefs: { has: entityId } },
      select: { valence: true },
    });
    if (rows.length === 0) return 0;
    return rows.reduce((s, r) => s + r.valence, 0) / rows.length;
  }

  async detectMoodShift(_userId: string): Promise<{
    shifted: boolean;
    direction?: 'up' | 'down';
    magnitude?: number;
    sinceDays?: number;
  } | null> {
    throw new Error('detectMoodShift not yet implemented — Task C3');
  }
}
