/**
 * v2.0 Phase B4 — PostgresHermes. CRUD for SkillDefinition with a
 * validate-on-create gate (validateSkillTools against the live registry +
 * blocklist). Reads are best-effort. Execution lives in the orchestrator,
 * not here.
 */

import { Prisma, type SkillDefinition } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { registry } from '../../tools/index.js';
import { validateSkillTools, type SkillSpec, type SkillStep } from './types.js';
import { embedQuery, embeddingsEnabled } from '../embeddings.js';

export interface HermesStore {
  createSkill(userId: string, spec: SkillSpec, source: string): Promise<SkillDefinition>;
  listSkills(userId: string): Promise<SkillDefinition[]>;
  activeSkills(userId: string): Promise<SkillDefinition[]>;
  getSkill(userId: string, name: string): Promise<SkillDefinition | null>;
  deleteSkill(userId: string, name: string): Promise<boolean>;
  bumpUsage(id: string): Promise<void>;
}

function knownToolNames(): Set<string> {
  return new Set(registry.keys());
}
function categoryOf(toolName: string): string {
  return registry.get(toolName)?.category ?? 'unknown';
}

export class PostgresHermes implements HermesStore {
  async createSkill(
    userId: string,
    spec: SkillSpec,
    source: string,
  ): Promise<SkillDefinition> {
    // Validate plan against the LIVE registry + blocklist (throws on bad).
    validateSkillTools(spec.plan, knownToolNames(), categoryOf);

    // Friendly unique-name handling: suffix on clash instead of throwing.
    let name = spec.name;
    for (let i = 2; i <= 9; i++) {
      const clash = await prisma.skillDefinition.findUnique({
        where: { userId_name: { userId, name } },
      });
      if (!clash) break;
      name = `${spec.name} (${i})`;
    }

    // Follow-up: cache the probe embedding so the router doesn't re-embed
    // this skill on every message. Best-effort — null on failure/disabled.
    let embedding: number[] | null = null;
    if (embeddingsEnabled()) {
      try {
        const probe = [spec.name, spec.description, ...(spec.triggers ?? [])].join('. ');
        const vec = await embedQuery(probe);
        if (Array.isArray(vec) && vec.length > 0) embedding = vec;
      } catch (err) {
        console.warn('[hermes:createSkill:embed] failed:',
          err instanceof Error ? err.message : err);
      }
    }

    return prisma.skillDefinition.create({
      data: {
        userId,
        name,
        description: spec.description,
        triggers: spec.triggers,
        plan: spec.plan as unknown as Prisma.InputJsonValue,
        embedding: embedding ? (embedding as unknown as Prisma.InputJsonValue) : undefined,
        synthesis: spec.synthesis,
        source,
      },
    });
  }

  async listSkills(userId: string): Promise<SkillDefinition[]> {
    try {
      return await prisma.skillDefinition.findMany({
        where: { userId },
        orderBy: { lastUsedAt: 'desc' },
      });
    } catch (err) {
      console.warn('[hermes:list] failed:', err);
      return [];
    }
  }

  async activeSkills(userId: string): Promise<SkillDefinition[]> {
    try {
      return await prisma.skillDefinition.findMany({
        where: { userId, active: true },
        orderBy: { useCount: 'desc' },
        take: 50,
      });
    } catch (err) {
      console.warn('[hermes:active] failed:', err);
      return [];
    }
  }

  async getSkill(userId: string, name: string): Promise<SkillDefinition | null> {
    try {
      return await prisma.skillDefinition.findUnique({
        where: { userId_name: { userId, name } },
      });
    } catch (err) {
      console.warn('[hermes:get] failed:', err);
      return null;
    }
  }

  async deleteSkill(userId: string, name: string): Promise<boolean> {
    try {
      await prisma.skillDefinition.delete({
        where: { userId_name: { userId, name } },
      });
      return true;
    } catch {
      return false;
    }
  }

  async bumpUsage(id: string): Promise<void> {
    try {
      await prisma.skillDefinition.update({
        where: { id },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      });
    } catch (err) {
      console.warn('[hermes:bump] failed:', err);
    }
  }
}

export type { SkillStep };
