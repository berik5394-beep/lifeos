/**
 * v2.0 Tier 5 — Identity mini.
 *
 * BotIdentity per user (botName/avatar/style/traits). Phase A is a thin
 * upsert wrapper; Phase B will accumulate emergent personality traits.
 *
 * On style update, also syncs User.assistantStyle so the existing 4-style
 * routing in claude-agent.ts continues to work without modification.
 *
 * No wiring to onboarding/UI here — Week 5/6 plans wire this in.
 */

import { prisma } from '../lib/prisma.js';
import type { BotIdentity } from '@prisma/client';

export type { BotIdentity };

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IdentityServiceStore {
  getIdentity(userId: string): Promise<BotIdentity>;
  updateIdentity(userId: string, updates: Partial<BotIdentity>): Promise<BotIdentity>;
}

// ---------------------------------------------------------------------------
// Pure helper (testable without DB)
// ---------------------------------------------------------------------------

type UpdatableKey = 'botName' | 'avatar' | 'style' | 'traits';
const UPDATABLE_KEYS: ReadonlyArray<UpdatableKey> = [
  'botName', 'avatar', 'style', 'traits',
];

/**
 * Whitelist update keys + drop undefined values. Prevents caller from
 * accidentally overwriting id/userId/createdAt.
 */
export function pickIdentityUpdates(
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of UPDATABLE_KEYS) {
    const v = updates[key];
    if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// IdentityService implementation
// ---------------------------------------------------------------------------

export class IdentityService implements IdentityServiceStore {
  async getIdentity(userId: string): Promise<BotIdentity> {
    return prisma.botIdentity.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        // schema defaults: botName='Эля', avatar='🤍', style='friendly', traits={}
      },
    });
  }

  async updateIdentity(
    userId: string,
    updates: Partial<BotIdentity>,
  ): Promise<BotIdentity> {
    // Ensure row exists first.
    const existing = await this.getIdentity(userId);

    const safeUpdates = pickIdentityUpdates(updates as Record<string, unknown>);

    // Sync User.assistantStyle if style changed.
    if (
      typeof safeUpdates.style === 'string' &&
      safeUpdates.style !== existing.style
    ) {
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { assistantStyle: safeUpdates.style },
        });
      } catch (err) {
        console.warn(
          '[bot-identity] User.assistantStyle sync failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    return prisma.botIdentity.update({
      where: { userId },
      data: safeUpdates,
    });
  }
}
