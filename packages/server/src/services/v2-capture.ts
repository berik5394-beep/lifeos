/**
 * v2.0 Week 5 D1 — INBOUND capture for new memory tiers.
 *
 * Fired from jarvis-orchestrator.captureInBackground when v2 memory is
 * enabled for the user. Runs in parallel with the legacy pipeline (dual-write)
 * so that legacy stays the source of truth for tasks while v2 builds richer
 * episodic/semantic/emotional state.
 *
 * NEVER throws — every sub-step is best-effort, logged on failure.
 * The orchestrator awaits this fire-and-forget; a partial fault must
 * not break legacy capture nor block the user reply.
 */

import { extractEntities } from './entity-extractor.js';
import { getEntityGraph } from './entity-graph/index.js';
import { recordEvent } from './episodic-memory.js';
import { getEmotionalMemory } from './emotional-memory.singleton.js';
import type { JsonValue } from '@prisma/client/runtime/library';

export async function captureV2InBackground(
  userId: string,
  text: string,
  msgId: string,
): Promise<void> {
  try {
    const graph = getEntityGraph();
    const emotional = getEmotionalMemory();

    // 1. Extract entities + relationships from message text.
    const extracted = await extractEntities(text, userId).catch((err) => {
      console.warn('[v2-capture] extractEntities failed:', err);
      return { entities: [], relationships: [] };
    });

    // 2. Upsert entities sequentially — graph dedupes on canonical name,
    //    parallel races would create duplicates.
    const idByName = new Map<string, string>();
    for (const ent of extracted.entities) {
      try {
        const input: Parameters<typeof graph.upsertEntity>[1] = {
          type: ent.type,
          name: ent.name,
          importance: ent.importance ?? 5,
        };
        if (ent.attributes) {
          input.attributes = ent.attributes as JsonValue;
        }
        const row = await graph.upsertEntity(userId, input);
        idByName.set(ent.name, row.id);
      } catch (err) {
        console.warn(`[v2-capture] upsertEntity ${ent.name} failed:`, err);
      }
    }

    // 3. Relationships — resolve endpoints (upsert if missing), then link.
    //    Done after the entity pass so names found in step 2 are available.
    for (const rel of extracted.relationships ?? []) {
      try {
        const fromId =
          idByName.get(rel.fromName) ??
          (await graph.upsertEntity(userId, { type: 'person', name: rel.fromName }))
            .id;
        const toId =
          idByName.get(rel.toName) ??
          (await graph.upsertEntity(userId, { type: 'person', name: rel.toName }))
            .id;
        idByName.set(rel.fromName, fromId);
        idByName.set(rel.toName, toId);
        await graph.linkEntities(userId, fromId, toId, rel.type ?? 'connected_to', {
          label: rel.label,
          strength: rel.strength,
        });
      } catch (err) {
        console.warn(
          `[v2-capture] linkEntities ${rel.fromName}→${rel.toName} failed:`,
          err,
        );
      }
    }

    // 4 + 5 — episodic event + emotional snapshot in parallel; both
    //   depend only on the entity IDs gathered above, not on each other.
    const entityRefs = Array.from(idByName.values());
    await Promise.allSettled([
      recordEvent(userId, {
        type: 'message',
        content: text,
        entityRefs,
      }).catch((err) => {
        console.warn('[v2-capture] recordEvent failed:', err);
      }),
      emotional.analyzeMessage(userId, msgId, text).catch((err) => {
        console.warn('[v2-capture] analyzeMessage failed:', err);
      }),
    ]);
  } catch (err) {
    // Top-level guard — must never throw to caller.
    console.warn('[v2-capture] unexpected error:', err);
  }
}
