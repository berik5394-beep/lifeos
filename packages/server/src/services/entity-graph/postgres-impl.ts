/**
 * v2.0 Tier 3 — PostgresEntityGraph: default implementation of EntityGraphStore.
 *
 * Uses Prisma ORM for all standard queries. Uses $queryRawUnsafe only for
 * the recursive CTE in getNeighbors (Prisma cannot express recursive CTEs).
 *
 * Embedding storage is best-effort: if Voyage is unavailable, entity is
 * saved without embedding — FTS still works for resolution.
 *
 * Pattern mirrors memory-service.ts:
 *  - embed helper: private best-effort async (like storeEmbedding)
 *  - resolveEntity: tiered FTS then embedding (like getRelevantMemories hybrid)
 */

import { prisma } from '../../lib/prisma.js';
import {
  embedDocument,
  embeddingsEnabled,
  toVectorLiteral,
} from '../embeddings.js';
import { Prisma, type Entity, type EntityRelationship } from '@prisma/client';
import type { EntityGraphStore } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Store entity embedding best-effort.
 * Does not throw — mirrors storeEmbedding in memory-service.ts.
 */
async function storeEntityEmbedding(id: string, name: string, aliases: string[]): Promise<void> {
  if (!embeddingsEnabled()) return;
  try {
    const text = aliases.length > 0 ? `${name} ${aliases.join(' ')}` : name;
    const vec = await embedDocument(text);
    if (!vec) return;
    await prisma.$executeRawUnsafe(
      'UPDATE "Entity" SET embedding = $1::vector WHERE id = $2',
      toVectorLiteral(vec),
      id,
    );
  } catch (err) {
    console.warn('[entity-graph] embed store failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Clamp graph traversal depth to [1, 5].
 * Prevents runaway recursive CTE. Min=1 (otherwise query is pointless).
 * Exported for unit testing.
 */
export function clampDepth(depth: number): number {
  return Math.max(1, Math.min(5, depth));
}

/**
 * Compute cutoff Date = now - sinceDays * 24h.
 * Exported for unit testing.
 */
export function sinceDaysCutoff(sinceDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - sinceDays * 86_400_000);
}

// ---------------------------------------------------------------------------
// PostgresEntityGraph
// ---------------------------------------------------------------------------

export class PostgresEntityGraph implements EntityGraphStore {
  // -------------------------------------------------------------------------
  // upsertEntity
  // -------------------------------------------------------------------------

  async upsertEntity(
    userId: string,
    entity: Partial<Entity> & { name: string; type: string },
  ): Promise<Entity> {
    const name = entity.name.trim().slice(0, 255);
    const type = entity.type.trim().slice(0, 64);
    const incomingAliases: string[] = (entity.aliases as string[] | undefined) ?? [];
    const attributes = (entity.attributes as Record<string, unknown> | undefined) ?? {};
    const importance = entity.importance ?? 5;

    // Try to find existing by unique index (userId, type, name).
    const existing = await prisma.entity.findUnique({
      where: { userId_type_name: { userId, type, name } },
    });

    if (existing) {
      // Merge aliases: union, deduplicate, preserve order (existing first).
      const mergedAliases = Array.from(
        new Set([...(existing.aliases as string[]), ...incomingAliases]),
      );
      // Merge attributes: spread existing, override with incoming.
      const mergedAttributes = {
        ...(existing.attributes as Record<string, unknown>),
        ...attributes,
      };

      const updated = await prisma.entity.update({
        where: { id: existing.id },
        data: {
          aliases: mergedAliases,
          attributes: mergedAttributes as Prisma.InputJsonValue,
          importance: Math.max(existing.importance, importance),
          lastSeenAt: new Date(),
        },
      });

      // Best-effort: update embedding with merged alias set.
      await storeEntityEmbedding(updated.id, updated.name, updated.aliases as string[]);
      return updated;
    }

    // Create new entity.
    const created = await prisma.entity.create({
      data: {
        userId,
        type,
        name,
        aliases: incomingAliases,
        attributes: attributes as Prisma.InputJsonValue,
        importance,
        lastSeenAt: new Date(),
      },
    });

    await storeEntityEmbedding(created.id, created.name, created.aliases as string[]);
    return created;
  }

  // -------------------------------------------------------------------------
  // getEntity — primary key lookup
  // -------------------------------------------------------------------------
  async getEntity(id: string): Promise<Entity | null> {
    return prisma.entity.findUnique({ where: { id } });
  }

  // -------------------------------------------------------------------------
  // resolveEntity — tiered FTS + embedding fallback
  // -------------------------------------------------------------------------
  async resolveEntity(userId: string, mention: string, type?: string): Promise<Entity | null> {
    const mentionClean = mention.trim().slice(0, 255);
    if (!mentionClean) return null;

    const typeFilter = type ? `AND e.type = '${type.replace(/'/g, "''")}'` : '';

    // Step 1: FTS match on canonical name (russian stemming).
    const nameFts = await prisma.$queryRawUnsafe<Entity[]>(
      `SELECT e.*
       FROM "Entity" e
       WHERE e."userId" = $1
         AND to_tsvector('russian', e.name) @@ plainto_tsquery('russian', $2)
         ${typeFilter}
       ORDER BY ts_rank(to_tsvector('russian', e.name), plainto_tsquery('russian', $2)) DESC
       LIMIT 1`,
      userId,
      mentionClean,
    );
    if (nameFts.length > 0) return nameFts[0];

    // Step 2: FTS match on aliases (unnested).
    const aliasFts = await prisma.$queryRawUnsafe<Entity[]>(
      `SELECT DISTINCT e.*
       FROM "Entity" e,
            unnest(e.aliases) AS alias_val
       WHERE e."userId" = $1
         AND to_tsvector('russian', alias_val) @@ plainto_tsquery('russian', $2)
         ${typeFilter}
       ORDER BY e.importance DESC
       LIMIT 1`,
      userId,
      mentionClean,
    );
    if (aliasFts.length > 0) return aliasFts[0];

    // Step 3: Embedding cosine similarity fallback.
    if (embeddingsEnabled()) {
      const { embedQuery } = await import('../embeddings.js');
      const qvec = await embedQuery(mentionClean);
      if (qvec) {
        const vecLit = toVectorLiteral(qvec);
        const typeFilterEmbed = type ? `AND e.type = '${type.replace(/'/g, "''")}'` : '';
        const embResult = await prisma.$queryRawUnsafe<Entity[]>(
          `SELECT e.*
           FROM "Entity" e
           WHERE e."userId" = $1
             AND e.embedding IS NOT NULL
             ${typeFilterEmbed}
           ORDER BY e.embedding <=> $2::vector
           LIMIT 1`,
          userId,
          vecLit,
        );
        if (embResult.length > 0) return embResult[0];
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // linkEntities — idempotent relationship upsert
  // -------------------------------------------------------------------------
  async linkEntities(
    userId: string,
    fromId: string,
    toId: string,
    type: string,
    opts?: { label?: string; strength?: number },
  ): Promise<EntityRelationship> {
    const strength = opts?.strength ?? 0.5;
    const label = opts?.label ?? null;

    // Check for existing active (invalidAt IS NULL) relationship of same triple.
    const existing = await prisma.entityRelationship.findFirst({
      where: {
        userId,
        fromId,
        toId,
        type,
        invalidAt: null,
      },
    });

    if (existing) {
      // Idempotent: update strength (take the MAX — relationship can only
      // strengthen, not weaken on repeated mention).
      return prisma.entityRelationship.update({
        where: { id: existing.id },
        data: {
          strength: Math.max(existing.strength, strength),
          label: label ?? existing.label,
        },
      });
    }

    // No active triple → create new relationship row.
    return prisma.entityRelationship.create({
      data: {
        userId,
        fromId,
        toId,
        type,
        label,
        strength,
        validAt: new Date(),
        invalidAt: null,
      },
    });
  }

  // -------------------------------------------------------------------------
  // getNeighbors — recursive CTE with depth cap
  // -------------------------------------------------------------------------
  async getNeighbors(
    entityId: string,
    depth: number,
  ): Promise<Array<{ entity: Entity; relation: EntityRelationship; distance: number }>> {
    const safeDepth = clampDepth(depth);

    // Recursive CTE with depth cap.
    // Base: direct neighbors (both directions, distance=1).
    // Recursive: follow outgoing edges from discovered neighbors.
    // UNION (not UNION ALL) deduplicates entityId per distance tier.
    type NeighborRow = Omit<Entity, never> & {
      distance: number;
      rel_id: string;
      rel_userId: string;
      rel_fromId: string;
      rel_toId: string;
      rel_type: string;
      rel_label: string | null;
      rel_strength: number;
      rel_validAt: Date;
      rel_invalidAt: Date | null;
      rel_createdAt: Date;
      rel_updatedAt: Date;
    };

    const rows = await prisma.$queryRawUnsafe<NeighborRow[]>(
      `WITH RECURSIVE neighbors AS (
        -- base: outgoing direct neighbors
        SELECT r."toId" AS "entityId", r.type AS "relType", r.label AS "relLabel",
               1 AS distance, r.id AS "relId"
        FROM "EntityRelationship" r
        WHERE r."fromId" = $1 AND r."invalidAt" IS NULL

        UNION

        -- base: incoming direct neighbors (bidirectional)
        SELECT r."fromId" AS "entityId", r.type AS "relType", r.label AS "relLabel",
               1 AS distance, r.id AS "relId"
        FROM "EntityRelationship" r
        WHERE r."toId" = $1 AND r."invalidAt" IS NULL

        UNION

        -- recursive: outgoing from discovered neighbors
        SELECT r."toId" AS "entityId", r.type AS "relType", r.label AS "relLabel",
               n.distance + 1 AS distance, r.id AS "relId"
        FROM neighbors n
        JOIN "EntityRelationship" r ON r."fromId" = n."entityId"
        WHERE n.distance < $2 AND r."invalidAt" IS NULL
      )
      SELECT DISTINCT ON (e.id)
        e.*,
        n.distance,
        r.id         AS "rel_id",
        r."userId"   AS "rel_userId",
        r."fromId"   AS "rel_fromId",
        r."toId"     AS "rel_toId",
        r.type       AS "rel_type",
        r.label      AS "rel_label",
        r.strength   AS "rel_strength",
        r."validAt"  AS "rel_validAt",
        r."invalidAt" AS "rel_invalidAt",
        r."createdAt" AS "rel_createdAt",
        r."updatedAt" AS "rel_updatedAt"
      FROM neighbors n
      JOIN "Entity" e ON e.id = n."entityId"
      JOIN "EntityRelationship" r ON r.id = n."relId"
      WHERE e.id != $1
      ORDER BY e.id, n.distance ASC, e.importance DESC`,
      entityId,
      safeDepth,
    );

    return rows.map((row) => ({
      entity: {
        id: row.id,
        userId: row.userId,
        type: row.type,
        name: row.name,
        aliases: row.aliases,
        attributes: row.attributes,
        lastSeenAt: row.lastSeenAt,
        baselineFreq: row.baselineFreq,
        moodAvg: row.moodAvg,
        importance: row.importance,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      } as Entity,
      relation: {
        id: row.rel_id,
        userId: row.rel_userId,
        fromId: row.rel_fromId,
        toId: row.rel_toId,
        type: row.rel_type,
        label: row.rel_label,
        strength: row.rel_strength,
        validAt: row.rel_validAt,
        invalidAt: row.rel_invalidAt,
        createdAt: row.rel_createdAt,
        updatedAt: row.rel_updatedAt,
      } as EntityRelationship,
      distance: row.distance,
    }));
  }

  // -------------------------------------------------------------------------
  // staleEntities — filter entities not seen in N days
  // -------------------------------------------------------------------------
  async staleEntities(userId: string, sinceDays: number, minImportance?: number): Promise<Entity[]> {
    const cutoff = sinceDaysCutoff(sinceDays);
    return prisma.entity.findMany({
      where: {
        userId,
        lastSeenAt: { lt: cutoff },
        ...(minImportance !== undefined ? { importance: { gte: minImportance } } : {}),
      },
      orderBy: { importance: 'desc' },
    });
  }
}
