/**
 * v2.0 Phase B1 — PostgresUserAxes — concrete implementation of
 * UserAxesStore using Prisma.
 *
 * Spec: docs/superpowers/specs/2026-05-31-v2-phase-b1-user-axes-design.md
 *
 * Design notes:
 *  - UserAxes table holds the *current* state, one row per user.
 *  - AxisSignal is the append-only log; every detected signal lands there.
 *  - On recordSignals: insert all signals first (createMany), then apply
 *    EWMA per axis, updating the UserAxes row in a single update.
 *  - getAxes auto-creates a default-0.5 row if missing — callers can rely
 *    on always getting back values.
 *  - Best-effort throughout: callers should not need to wrap our methods
 *    in try/catch; we already do.
 */

import { prisma } from '../../lib/prisma.js';
import {
  AXIS_DEFAULTS,
  applyEwma,
  type AxisName,
  type AxisSignalInput,
  type AxisSignalSource,
  type UserAxesStore,
  type UserAxesValues,
} from './types.js';

export class PostgresUserAxes implements UserAxesStore {
  async getAxes(userId: string): Promise<UserAxesValues> {
    try {
      let row = await prisma.userAxes.findUnique({ where: { userId } });
      if (!row) {
        row = await prisma.userAxes.create({
          data: {
            userId,
            selfDiscipline: AXIS_DEFAULTS.self_discipline,
            emotionalOpenness: AXIS_DEFAULTS.emotional_openness,
            conflictTolerance: AXIS_DEFAULTS.conflict_tolerance,
            introspectionDepth: AXIS_DEFAULTS.introspection_depth,
            signalCount: 0,
            lastSignalAt: null,
          },
        });
      }
      return {
        selfDiscipline: row.selfDiscipline,
        emotionalOpenness: row.emotionalOpenness,
        conflictTolerance: row.conflictTolerance,
        introspectionDepth: row.introspectionDepth,
        signalCount: row.signalCount,
        lastSignalAt: row.lastSignalAt,
      };
    } catch (err) {
      console.warn('[user-axes:getAxes] failed:', err);
      // Even on failure return defaults so callers always get a sensible
      // structure (prompt enrichment + content rules tolerate this).
      return {
        selfDiscipline: AXIS_DEFAULTS.self_discipline,
        emotionalOpenness: AXIS_DEFAULTS.emotional_openness,
        conflictTolerance: AXIS_DEFAULTS.conflict_tolerance,
        introspectionDepth: AXIS_DEFAULTS.introspection_depth,
        signalCount: 0,
        lastSignalAt: null,
      };
    }
  }

  async recordSignals(
    userId: string,
    msgId: string | null,
    signals: AxisSignalInput[],
    source: AxisSignalSource = 'claude_classifier',
  ): Promise<{ written: number; skipped: number }> {
    if (signals.length === 0) return { written: 0, skipped: 0 };

    let written = 0;
    let skipped = 0;
    try {
      // 1. Bulk-insert all signals (append-only log).
      const insertResult = await prisma.axisSignal.createMany({
        data: signals.map((s) => ({
          userId,
          msgId,
          axis: s.axis,
          delta: s.delta,
          confidence: s.confidence,
          excerpt: s.excerpt ?? null,
          source,
        })),
        skipDuplicates: false,
      });
      written = insertResult.count;
      skipped = signals.length - written;

      // 2. Apply EWMA per axis on top of current values, then single update.
      const current = await this.getAxes(userId);
      const axisFieldByName: Record<
        AxisName,
        'selfDiscipline' | 'emotionalOpenness' | 'conflictTolerance' | 'introspectionDepth'
      > = {
        self_discipline: 'selfDiscipline',
        emotional_openness: 'emotionalOpenness',
        conflict_tolerance: 'conflictTolerance',
        introspection_depth: 'introspectionDepth',
      };

      const next: Record<
        'selfDiscipline' | 'emotionalOpenness' | 'conflictTolerance' | 'introspectionDepth',
        number
      > = {
        selfDiscipline: current.selfDiscipline,
        emotionalOpenness: current.emotionalOpenness,
        conflictTolerance: current.conflictTolerance,
        introspectionDepth: current.introspectionDepth,
      };
      for (const s of signals) {
        const field = axisFieldByName[s.axis];
        next[field] = applyEwma(next[field], s.delta, s.confidence);
      }

      await prisma.userAxes.update({
        where: { userId },
        data: {
          ...next,
          signalCount: { increment: written },
          lastSignalAt: new Date(),
        },
      });
    } catch (err) {
      console.warn('[user-axes:recordSignals] failed:', err);
      // Don't increment `written`; signals may have inserted before the
      // update failed — log so it's debuggable, but caller still gets
      // back numbers.
    }

    return { written, skipped };
  }

  async recentSignals(
    _userId: string,
    _axis: AxisName,
    _limit?: number,
  ): Promise<Array<{
    delta: number;
    confidence: number;
    excerpt: string | null;
    recordedAt: Date;
  }>> {
    // Implemented in B4.
    throw new Error('recentSignals not yet implemented — Task B4');
  }

  async recomputeFromSignals(_userId: string): Promise<UserAxesValues> {
    // Implemented in B4.
    throw new Error('recomputeFromSignals not yet implemented — Task B4');
  }
}
