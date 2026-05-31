/**
 * v2.0 Phase B2 — PostgresBotTraits — concrete BotTraitsStore.
 *
 * Spec §4-5. Traits computed via pure formula from B1 user axes +
 * relationship stats, persisted into the existing BotIdentity.traits JSON.
 * Best-effort throughout — never throws to callers.
 */

import { prisma } from '../../lib/prisma.js';
import { getUserAxesStore } from '../user-axes/index.js';
import {
  DEFAULT_TRAITS,
  computeBotTraits,
  computeRelationshipDepth,
  parseTraitsJson,
  type BotTraits,
  type BotTraitsStore,
  type RelationshipStats,
  type TraitSnapshot,
} from './types.js';
import type { Prisma } from '@prisma/client';

export class PostgresBotTraits implements BotTraitsStore {
  async getTraits(userId: string): Promise<BotTraits> {
    try {
      const identity = await prisma.botIdentity.findUnique({
        where: { userId },
        select: { traits: true },
      });
      if (!identity) return { ...DEFAULT_TRAITS };
      return parseTraitsJson(identity.traits);
    } catch (err) {
      console.warn('[bot-traits:getTraits] failed:', err);
      return { ...DEFAULT_TRAITS };
    }
  }

  async refreshTraits(userId: string): Promise<BotTraits> {
    try {
      // 1. Gather relationship stats.
      const [messageCount, firstMsg, distinctEntities, emotionalMoments] =
        await Promise.all([
          prisma.chatMessage.count({ where: { userId } }),
          prisma.chatMessage.findFirst({
            where: { userId },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          }),
          prisma.entity.count({ where: { userId } }),
          prisma.moodSnapshot.count({
            where: { userId, OR: [{ valence: { gt: 0.4 } }, { valence: { lt: -0.4 } }] },
          }),
        ]);

      const daysSinceFirst = firstMsg
        ? Math.max(0, (Date.now() - firstMsg.createdAt.getTime()) / 86400_000)
        : 0;

      const stats: RelationshipStats = {
        messageCount,
        daysSinceFirst,
        distinctEntities,
        emotionalMoments,
      };
      const depth = computeRelationshipDepth(stats);

      // 2. Read B1 user axes (graceful: defaults 0.5 if B1 off).
      const axes = await getUserAxesStore().getAxes(userId);
      const traits = computeBotTraits(
        axes.emotionalOpenness,
        axes.conflictTolerance,
        depth,
      );

      const now = new Date();
      const blob = {
        warmth: traits.warmth,
        directness: traits.directness,
        humor: traits.humor,
        playfulness: traits.playfulness,
        relationshipDepth: depth,
        lastComputedAt: now.toISOString(),
      };

      // 3. Persist into BotIdentity.traits (upsert — identity may not exist).
      await prisma.botIdentity.upsert({
        where: { userId },
        create: { userId, traits: blob as Prisma.InputJsonValue },
        update: { traits: blob as Prisma.InputJsonValue },
      });

      return {
        warmth: traits.warmth,
        directness: traits.directness,
        humor: traits.humor,
        playfulness: traits.playfulness,
        relationshipDepth: depth,
        lastComputedAt: now,
      };
    } catch (err) {
      console.warn('[bot-traits:refreshTraits] failed:', err);
      return this.getTraits(userId);
    }
  }

  async refreshTraitsIfStale(_userId: string, _staleMs?: number): Promise<BotTraits> {
    throw new Error('refreshTraitsIfStale not yet implemented — Task B3');
  }

  async snapshot(_userId: string): Promise<void> {
    throw new Error('snapshot not yet implemented — Task B3');
  }

  async snapshotHistory(_userId: string, _limit?: number): Promise<TraitSnapshot[]> {
    throw new Error('snapshotHistory not yet implemented — Task B3');
  }
}
