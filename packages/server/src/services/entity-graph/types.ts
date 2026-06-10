/**
 * v2.0 Tier 3 — Entity Graph interface + type re-exports.
 *
 * EntityGraphStore abstracts the storage backend (Postgres default;
 * Neo4j possible future swap) so consumers (jarvis-orchestrator, Week 5)
 * bind to the interface, not to PostgresEntityGraph directly.
 *
 * Types Entity + EntityRelationship come from @prisma/client (generated
 * from the schema added in Week 2).
 */

import type { Entity, EntityRelationship } from '@prisma/client';

// Re-export Prisma types so consumers can import from one place.
export type { Entity, EntityRelationship };

export interface EntityGraphStore {
  /**
   * Resolve a canonical Entity from a raw mention string (e.g. "маме",
   * "Серик", "работа"). Strategy:
   *   1. FTS exact name match (plainto_tsquery russian, name column)
   *   2. FTS alias match (aliases array, unnested)
   *   3. pgvector cosine similarity fallback (if Voyage available)
   *
   * Returns null if nothing matches above threshold.
   * Returns the BEST single match (caller handles ambiguity via context).
   *
   * If type provided, restricts search to that entity type.
   */
  resolveEntity(userId: string, mention: string, type?: string): Promise<Entity | null>;

  /**
   * Как resolveEntity, но эмбеддинг-тир (Tier 3) принимается ТОЛЬКО при
   * cosine-distance ≤ порога (shouldMergeByEmbedding). Для записи/склейки,
   * где ложная склейка дороже, чем промах. type обязателен (склеиваем только
   * однотипные сущности). Tier 1/2 (FTS имя/алиасы) — высокоточные, без порога.
   *
   * Returns null если ничего не совпало (или эмбеддинг за порогом).
   */
  resolveForMerge(userId: string, mention: string, type: string): Promise<Entity | null>;

  /**
   * Create or upsert entity. Uses @@unique([userId, type, name]) to
   * detect existing. If exists: merges aliases (union), updates
   * lastSeenAt, merges attributes. Stores embedding best-effort.
   *
   * Returns the canonical (created or updated) Entity row.
   */
  upsertEntity(
    userId: string,
    entity: Partial<Entity> & { name: string; type: string },
    opts?: { deliberate?: boolean },
  ): Promise<Entity>;

  /**
   * Get entity by primary key. Returns null if not found.
   */
  getEntity(id: string): Promise<Entity | null>;

  /**
   * Create or update EntityRelationship. Idempotent on triple
   * (fromId, toId, type, validAt=now-day). If identical triple already
   * exists: UPDATE strength (MAX), return existing row. Never duplicates.
   *
   * opts.strength defaults to 0.5 if omitted.
   */
  linkEntities(
    userId: string,
    fromId: string,
    toId: string,
    type: string,
    opts?: { label?: string; strength?: number },
  ): Promise<EntityRelationship>;

  /**
   * Traverse entity graph outward from entityId up to `depth` hops
   * (hard-capped at 5 to prevent runaway). Uses Postgres recursive CTE.
   * Bidirectional: follows both from→to and to→from edges.
   * Excludes invalidated relationships (invalidAt IS NULL).
   *
   * Returns deduplicated neighbors ordered by distance ASC,
   * importance DESC within each distance tier.
   */
  getNeighbors(
    entityId: string,
    depth: number,
  ): Promise<Array<{ entity: Entity; relation: EntityRelationship; distance: number }>>;

  /**
   * Find entities the user hasn't mentioned in the last `sinceDays` days
   * (lastSeenAt < now - sinceDays). Optional minImportance filter.
   * Returns ordered by importance DESC.
   */
  staleEntities(userId: string, sinceDays: number, minImportance?: number): Promise<Entity[]>;

  /** Активные (invalidAt IS NULL) связи, ссылающиеся на сущность (как from ИЛИ to). */
  activeLinksForEntity(userId: string, entityId: string): Promise<EntityRelationship[]>;
  /** Ретайр связи (обратимо): UPDATE invalidAt=now WHERE id+userId+active. Cross-user-safe. */
  invalidateLink(userId: string, relationshipId: string): Promise<void>;
}
