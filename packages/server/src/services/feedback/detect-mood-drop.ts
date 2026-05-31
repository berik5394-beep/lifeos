/**
 * v2.0 Phase B3 — Implicit feedback signal #1: mood drop.
 *
 * Compares the two most recent MoodSnapshot rows (1-turn lag, spec §6).
 * A significant valence fall right after a bot turn hints the bot's
 * approach didn't land — fed as a flag into classifyFeedback.
 *
 * Best-effort: any error or insufficient data → { moodDropped:false,
 * moodDelta:null }. Never throws.
 */

import { prisma } from '../../lib/prisma.js';
import { isMoodDrop } from './types.js';

export async function detectMoodDrop(
  userId: string,
): Promise<{ moodDropped: boolean; moodDelta: number | null }> {
  try {
    const snaps = await prisma.moodSnapshot.findMany({
      where: { userId },
      orderBy: { recordedAt: 'desc' },
      take: 2,
      select: { valence: true },
    });
    if (snaps.length < 2) return { moodDropped: false, moodDelta: null };
    const after = snaps[0].valence;
    const before = snaps[1].valence;
    return {
      moodDropped: isMoodDrop(before, after),
      moodDelta: after - before,
    };
  } catch (err) {
    console.warn('[feedback:mood-drop] failed:',
      err instanceof Error ? err.message : err);
    return { moodDropped: false, moodDelta: null };
  }
}
