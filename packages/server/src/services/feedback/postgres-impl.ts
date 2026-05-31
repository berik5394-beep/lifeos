/**
 * v2.0 Phase B3 — PostgresFeedback. Applies a recognised reaction:
 *   1. routes axis signals into the B1 store (source='feedback') — reuse
 *      EWMA + persistence; B2 traits follow deterministically.
 *   2. writes a CorrectionLog row for transparency (/axes tail).
 *
 * Best-effort throughout — callers (v2-capture branch) need no try/catch.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getUserAxesStore } from '../user-axes/index.js';
import type {
  FeedbackResult,
  FeedbackSignalType,
  ImplicitFlags,
} from './types.js';

export interface RecentCorrection {
  styleNote: string | null;
  dimension: string;
  valence: string;
  signalType: string;
  recordedAt: Date;
}

export interface FeedbackStore {
  applyFeedback(
    userId: string,
    msgId: string | null,
    botExcerpt: string,
    userExcerpt: string,
    result: FeedbackResult,
    signalType: FeedbackSignalType,
    flags: ImplicitFlags,
  ): Promise<void>;

  recentCorrections(userId: string, limit?: number): Promise<RecentCorrection[]>;
}

export class PostgresFeedback implements FeedbackStore {
  async applyFeedback(
    userId: string,
    msgId: string | null,
    botExcerpt: string,
    userExcerpt: string,
    result: FeedbackResult,
    signalType: FeedbackSignalType,
    flags: ImplicitFlags,
  ): Promise<void> {
    // 1. Route axis signals into B1 (reuse EWMA). Skip if none — avoids
    //    needless UserAxes churn for understanding/content-only misses.
    if (result.axisSignals.length > 0) {
      try {
        await getUserAxesStore().recordSignals(
          userId,
          msgId,
          result.axisSignals,
          'feedback'
        );
      } catch (err) {
        console.warn(
          '[feedback:apply:axes] failed:',
          err instanceof Error ? err.message : err
        );
      }
    }

    // 2. Audit row for transparency. Snapshot text (not FK) — robust to
    //    ChatMessage retention purge.
    try {
      await prisma.correctionLog.create({
        data: {
          userId,
          userMsgId: msgId,
          botExcerpt: botExcerpt.slice(0, 280),
          userExcerpt: userExcerpt.slice(0, 280),
          signalType,
          valence: result.valence,
          dimension: result.dimension,
          appliedSignals: result.axisSignals as unknown as Prisma.InputJsonValue,
          styleNote: result.styleNote,
          moodDelta: flags.moodDelta,
          reaskSim: flags.reaskSim,
        },
      });
    } catch (err) {
      console.warn(
        '[feedback:apply:log] failed:',
        err instanceof Error ? err.message : err
      );
    }
  }

  async recentCorrections(
    userId: string,
    limit = 5
  ): Promise<RecentCorrection[]> {
    try {
      const rows = await prisma.correctionLog.findMany({
        where: { userId },
        orderBy: { recordedAt: 'desc' },
        take: limit,
        select: {
          styleNote: true,
          dimension: true,
          valence: true,
          signalType: true,
          recordedAt: true,
        },
      });
      return rows;
    } catch (err) {
      console.warn(
        '[feedback:recent] failed:',
        err instanceof Error ? err.message : err
      );
      return [];
    }
  }
}
