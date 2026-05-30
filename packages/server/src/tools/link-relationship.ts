import { z } from 'zod';
import { defineTool } from './_types.js';
import { getEntityGraph } from '../services/entity-graph/index.js';

/**
 * v2.0 Week 5 — agent-callable relationship edge writer. Resolves the
 * two endpoints by name (upsert by canonical name, type defaults to
 * 'person'); writes a typed edge. Reversible (edges are deduped by
 * (from,to,type) in entity-graph) → needsConfirm:false.
 */
export const linkRelationshipTool = defineTool({
  name: 'link_relationship',
  description:
    'Связать два запомненных entities направленным ребром (мама → Серик, ' +
    'type=family). Если endpoint ещё не записан — создастся как person.',
  category: 'memory',
  schema: z.object({
    fromName: z.string().min(1).max(120),
    toName: z.string().min(1).max(120),
    type: z.string().min(1).max(40),
    label: z.string().max(120).optional(),
  }),
  needsConfirm: false,
  sideEffects: 'write',
  examples: ['свяжи маму и Серика как семью'],
  handler: async (input, ctx) => {
    const graph = getEntityGraph();
    const [from, to] = await Promise.all([
      graph.upsertEntity(ctx.userId, {
        type: 'person',
        name: input.fromName,
      }),
      graph.upsertEntity(ctx.userId, { type: 'person', name: input.toName }),
    ]);
    const edge = await getEntityGraph().linkEntities(
      ctx.userId,
      from.id,
      to.id,
      input.type,
      { label: input.label },
    );
    return {
      message: `Связал: ${from.name} → ${to.name} (${input.type})`,
      edgeId: edge.id,
    };
  },
});
