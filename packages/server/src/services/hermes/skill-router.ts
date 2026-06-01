/**
 * v2.0 Phase B4 — Hermes skill router. Picks the skill for a turn:
 * exact-name match first (cheap), else Voyage cosine of the message vs
 * each skill's triggers/description. Best-effort → null.
 */

import { embedQuery, embeddingsEnabled } from '../embeddings.js';
import { cosineSimilarity } from '../procedural-memory.js';
import type { SkillDefinition } from '@prisma/client';

const ROUTE_THRESHOLD = 0.8;

export async function routeToSkill(
  _userId: string,
  text: string,
  activeSkills: SkillDefinition[],
): Promise<SkillDefinition | null> {
  const t = (text ?? '').trim().toLowerCase();
  if (t.length === 0 || activeSkills.length === 0) return null;

  // 1. Exact-name fast path (also covers "/skills run <name>").
  for (const s of activeSkills) {
    if (t === s.name.toLowerCase() || t.includes(s.name.toLowerCase())) {
      return s;
    }
  }

  // 2. Semantic match via Voyage. Best-effort.
  if (!embeddingsEnabled()) return null;
  try {
    const q = await embedQuery(text);
    if (!q || q.length === 0) return null;
    let best: SkillDefinition | null = null;
    let bestSim = -1;
    for (const s of activeSkills) {
      let emb: number[] | null | undefined;
      const stored = (s as { embedding?: unknown }).embedding;
      if (Array.isArray(stored) && stored.length > 0 && typeof stored[0] === 'number') {
        emb = stored as number[];
      } else {
        const probe = [s.name, s.description, ...(s.triggers ?? [])].join('. ');
        emb = await embedQuery(probe);
      }
      if (!emb || emb.length === 0) continue;
      const sim = cosineSimilarity(q, emb);
      if (sim > bestSim) { bestSim = sim; best = s; }
    }
    return bestSim >= ROUTE_THRESHOLD ? best : null;
  } catch (err) {
    console.warn('[hermes:router] failed:',
      err instanceof Error ? err.message : err);
    return null;
  }
}
