/**
 * v2.0 Phase B3 — Implicit feedback signal #2: re-ask.
 *
 * If the user re-asks something semantically close to a recent question,
 * the bot's earlier answer likely missed. Embeds the current message and
 * compares (cosine) against recent user messages from the last 24h.
 *
 * Gated by looksLikeQuestion (cheap) + embeddingsEnabled — ~80% of
 * messages skip the Voyage call. Best-effort: error → { false, null }.
 */

import { prisma } from '../../lib/prisma.js';
import { embedQuery, embeddingsEnabled } from '../embeddings.js';
import { cosineSimilarity } from '../procedural-memory.js';
import { looksLikeQuestion } from './types.js';

const REASK_THRESHOLD = 0.82;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function detectReAsk(
  userId: string,
  text: string,
  currentMsgId: string,
): Promise<{ isReAsk: boolean; reaskSim: number | null }> {
  if (!looksLikeQuestion(text) || !embeddingsEnabled()) {
    return { isReAsk: false, reaskSim: null };
  }
  try {
    const since = new Date(Date.now() - DAY_MS);
    const recent = await prisma.chatMessage.findMany({
      where: {
        userId,
        role: 'user',
        createdAt: { gte: since },
        id: { not: currentMsgId },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { content: true },
    });
    const prior = recent
      .map((m) => m.content?.trim())
      .filter((c): c is string => !!c && looksLikeQuestion(c));
    if (prior.length === 0) return { isReAsk: false, reaskSim: null };

    const cur = await embedQuery(text);
    if (!cur || cur.length === 0) return { isReAsk: false, reaskSim: null };

    let maxSim = -1;
    for (const q of prior) {
      const emb = await embedQuery(q);
      if (!emb || emb.length === 0) continue;
      const sim = cosineSimilarity(cur, emb);
      if (sim > maxSim) maxSim = sim;
    }
    if (maxSim < 0) return { isReAsk: false, reaskSim: null };
    return { isReAsk: maxSim >= REASK_THRESHOLD, reaskSim: maxSim };
  } catch (err) {
    console.warn('[feedback:re-ask] failed:',
      err instanceof Error ? err.message : err);
    return { isReAsk: false, reaskSim: null };
  }
}
