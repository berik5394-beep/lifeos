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
  // resolveEntity — placeholder; implemented in B3
  // -------------------------------------------------------------------------
  async resolveEntity(_userId: string, _mention: string, _type?: string): Promise<Entity | null> {
    throw new Error('resolveEntity not yet implemented — Task B3');
  }

  // -------------------------------------------------------------------------
  // linkEntities — placeholder; implemented in B4
  // -------------------------------------------------------------------------
  async linkEntities(
    _userId: string,
    _fromId: string,
    _toId: string,
    _type: string,
    _opts?: { label?: string; strength?: number },
  ): Promise<EntityRelationship> {
    throw new Error('linkEntities not yet implemented — Task B4');
  }

  // -------------------------------------------------------------------------
  // getNeighbors — placeholder; implemented in B5
  // -------------------------------------------------------------------------
  async getNeighbors(
    _entityId: string,
    _depth: number,
  ): Promise<Array<{ entity: Entity; relation: EntityRelationship; distance: number }>> {
    throw new Error('getNeighbors not yet implemented — Task B5');
  }

  // -------------------------------------------------------------------------
  // staleEntities — placeholder; implemented in B6
  // -------------------------------------------------------------------------
  async staleEntities(
    _userId: string,
    _sinceDays: number,
    _minImportance?: number,
  ): Promise<Entity[]> {
    throw new Error('staleEntities not yet implemented — Task B6');
  }
}
