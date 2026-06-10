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
import { capAliases, mergeAttributes, shouldMergeByEmbedding } from './merge-helpers.js';
import { isV2EntityResolveEnabled, isV2MemGraphEnabled } from '../../lib/feature-flags.js';
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
 * Явный список колонок Entity (алиас e), БЕЗ embedding. Колонка embedding —
 * Unsupported("vector(512)") — Prisma не умеет десериализовать её в $queryRaw,
 * поэтому `SELECT e.*` падает. Поля совпадают с типом Entity (embedding в нём
 * отсутствует), так что результат корректно типизируется как Entity.
 */
const COLS =
  'e.id, e."userId", e.type, e.name, e.aliases, e.attributes, e."lastSeenAt", ' +
  'e."baselineFreq", e."moodAvg", e.importance, e."createdAt", e."updatedAt"';

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
    opts?: { deliberate?: boolean },
  ): Promise<Entity> {
    // Стратегия записи: точный матч → update; иначе (флаг) resolve→merge update;
    // иначе prisma.entity.create. Никогда не prisma.entity.upsert (разветвление выше).
    const name = entity.name.trim().slice(0, 255);
    const type = entity.type.trim().slice(0, 64);
    const resolveOn = isV2EntityResolveEnabled(userId);
    // off=байт-идентично: при выключенном флаге игнорим входящие алиасы
    // (исторически их не было) → alias-мёрж no-op, эмбеддинги те же.
    const incomingAliases: string[] = resolveOn
      ? ((entity.aliases as string[] | undefined) ?? [])
      : [];
    const attributes = (entity.attributes as Record<string, unknown> | undefined) ?? {};
    const importance = entity.importance ?? 5;
    const deliberate = opts?.deliberate ?? false;

    // Точный матч по (userId, type, name) — приоритет, как сейчас.
    const existing = await prisma.entity.findUnique({
      where: { userId_type_name: { userId, type, name } },
    });
    if (existing) {
      // off: алиасы НЕ трогаем (структурно байт-идентично — без capAliases-нормализации
      // даже если у строки уже есть алиасы); on: union существующих + входящих.
      const mergedAliases = resolveOn
        ? capAliases([...(existing.aliases as string[]), ...incomingAliases])
        : (existing.aliases as string[]);
      const mergedAttributes = isV2MemGraphEnabled(userId)
        ? mergeAttributes(existing.attributes as Record<string, unknown>, attributes, deliberate)
        : { ...(existing.attributes as Record<string, unknown>), ...attributes };
      const updated = await prisma.entity.update({
        where: { id: existing.id },
        data: {
          aliases: mergedAliases,
          attributes: mergedAttributes as Prisma.InputJsonValue,
          importance: Math.max(existing.importance, importance),
          lastSeenAt: new Date(),
        },
      });
      await storeEntityEmbedding(updated.id, updated.name, updated.aliases as string[]);
      return updated;
    }

    // Нет точного матча. Resolve-then-merge ТОЛЬКО при флаге.
    if (resolveOn) {
      const resolved = await this.resolveForMerge(userId, name, type);
      if (resolved) {
        const mergedAliases = capAliases([
          ...(resolved.aliases as string[]),
          name, // новая форма имени → в алиасы
          ...incomingAliases,
        ]);
        const mergedAttributes = isV2MemGraphEnabled(userId)
          ? mergeAttributes(resolved.attributes as Record<string, unknown>, attributes, deliberate)
          : { ...(resolved.attributes as Record<string, unknown>), ...attributes };
        const updated = await prisma.entity.update({
          where: { id: resolved.id },
          data: {
            aliases: mergedAliases,
            attributes: mergedAttributes as Prisma.InputJsonValue,
            importance: Math.max(resolved.importance, importance),
            lastSeenAt: new Date(),
          },
        });
        await storeEntityEmbedding(updated.id, updated.name, updated.aliases as string[]);
        return updated;
      }
    }

    // Создать новую (OFF: incomingAliases=[] → как сейчас).
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
    // NOTE: SELECT ${COLS} — NOT e.* — to avoid deserializing the Unsupported
    // vector(512) embedding column (mirrors resolveForMerge fix).
    const nameFts = await prisma.$queryRawUnsafe<Entity[]>(
      `SELECT ${COLS}
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
      `SELECT DISTINCT ${COLS}
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
          `SELECT ${COLS}
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
  // resolveForMerge — как resolveEntity, но эмбеддинг-тир за ПОРОГОМ (для записи).
  // Tier1/2 (FTS имя/алиасы) высокоточные — принять; Tier3 — только dist ≤ порог.
  // type обязателен (склеиваем только однотипные). Best-effort → null.
  // -------------------------------------------------------------------------
  async resolveForMerge(userId: string, mention: string, type: string): Promise<Entity | null> {
    const mentionClean = mention.trim().slice(0, 255);
    if (!mentionClean) return null;
    const tf = `AND e.type = '${type.replace(/'/g, "''")}'`; // type обязателен
    const q = (s: string) => prisma.$queryRawUnsafe<Entity[]>(s, userId, mentionClean);
    // Точность: матч ТОЛЬКО при РАВЕНСТВЕ множеств стем-лексем (не подмножество).
    // tsvector_to_array(...) → отсортированный distinct список лексем; сравнение
    // массивов на равенство порядко-независимо. Loose `@@` мёржил любое общее
    // слово (Бюджет ↔ Остаток бюджета), set-равенство — нет. Склонения проходят
    // (Серик={серик}=Сериком). cardinality(...)>0 — не матчим имена из одних
    // стоп-слов/пунктуации (пустое множество = пустому → ложный мёрж).
    const nv = `to_tsvector('russian', e.name)`;
    const mv = `to_tsvector('russian', $2)`;
    const eqSet = `cardinality(tsvector_to_array(${mv})) > 0 AND tsvector_to_array(${nv}) = tsvector_to_array(${mv})`;
    try {
      // Tier 1/2: FTS имя/алиасы (COLS — без embedding, см. note выше).
      const t1 = await q(`SELECT ${COLS} FROM "Entity" e WHERE e."userId"=$1 AND ${eqSet} ${tf} ORDER BY e.importance DESC, e."createdAt" ASC LIMIT 1`);
      if (t1.length > 0) return t1[0];
      const t2 = await q(`SELECT DISTINCT ${COLS} FROM "Entity" e, unnest(e.aliases) av WHERE e."userId"=$1 AND cardinality(tsvector_to_array(${mv})) > 0 AND tsvector_to_array(to_tsvector('russian', av)) = tsvector_to_array(${mv}) ${tf} ORDER BY e.importance DESC LIMIT 1`);
      if (t2.length > 0) return t2[0];

      // Tier 3: эмбеддинг — принять ТОЛЬКО при dist ≤ порога.
      if (embeddingsEnabled()) {
        const { embedQuery } = await import('../embeddings.js');
        const qvec = await embedQuery(mentionClean);
        if (qvec) {
          const v = toVectorLiteral(qvec);
          const rows = await prisma.$queryRawUnsafe<Array<Entity & { dist: number }>>(
            `SELECT ${COLS}, (e.embedding <=> $2::vector) AS dist FROM "Entity" e WHERE e."userId"=$1 AND e.embedding IS NOT NULL ${tf} ORDER BY e.embedding <=> $2::vector LIMIT 1`,
            userId,
            v,
          );
          if (rows.length > 0 && shouldMergeByEmbedding(Number(rows[0].dist))) {
            const { dist: _dist, ...ent } = rows[0];
            return ent as Entity;
          }
        }
      }
      return null;
    } catch (err) {
      console.warn('[entity-graph] resolveForMerge failed:', err instanceof Error ? err.message : err);
      return null;
    }
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
  // activeLinksForEntity — active relationships referencing an entity
  // -------------------------------------------------------------------------
  async activeLinksForEntity(userId: string, entityId: string): Promise<EntityRelationship[]> {
    return prisma.entityRelationship.findMany({
      where: { userId, invalidAt: null, OR: [{ fromId: entityId }, { toId: entityId }] },
    });
  }

  // -------------------------------------------------------------------------
  // invalidateLink — soft-retire a relationship (reversible, cross-user-safe)
  // -------------------------------------------------------------------------
  async invalidateLink(userId: string, relationshipId: string): Promise<void> {
    await prisma.entityRelationship.updateMany({
      where: { id: relationshipId, userId, invalidAt: null },
      data: { invalidAt: new Date() },
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
