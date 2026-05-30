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
    _userId: string,
    _sinceDays: number,
  ): Promise<Array<{ date: string; valence: number; emotion: string }>> {
    throw new Error('getMoodTimeline not yet implemented — Task C2');
  }

  async getEntityMood(_userId: string, _entityId: string): Promise<number> {
    throw new Error('getEntityMood not yet implemented — Task C2');
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
