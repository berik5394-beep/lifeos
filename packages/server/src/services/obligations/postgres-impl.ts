import { prisma } from '../../lib/prisma.js';
import type { Direction, ObligationKind } from './types.js';

export type CreateInput = {
  userId: string;
  personName: string;
  personEntityId?: string | null;
  direction: Direction;
  kind: ObligationKind;
  description: string;
  amount?: number | null;
  currency?: string | null;
  dueDate?: Date | null;
  source: 'manual' | 'ai_suggested';
  note?: string | null;
};

export async function createObligation(input: CreateInput) {
  return prisma.obligation.create({
    data: {
      userId: input.userId,
      personName: input.personName,
      personEntityId: input.personEntityId ?? null,
      direction: input.direction,
      kind: input.kind,
      description: input.description,
      amount: input.kind === 'money' ? (input.amount ?? null) : null,
      currency: input.currency ?? '₸',
      dueDate: input.dueDate ?? null,
      status: 'open',
      source: input.source,
      note: input.note ?? null,
    },
  });
}

export async function listObligations(
  userId: string,
  opts: { status?: string; direction?: Direction; personName?: string } = {},
) {
  return prisma.obligation.findMany({
    where: {
      userId,
      status: opts.status ?? 'open',
      ...(opts.direction ? { direction: opts.direction } : {}),
      ...(opts.personName
        ? { personName: { contains: opts.personName, mode: 'insensitive' } }
        : {}),
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  });
}

/** Закрыть (выполнено) — атомарно с проверкой ownership (паттерн tasks DELETE). */
export async function settleObligation(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const o = await tx.obligation.findFirst({ where: { id, userId } });
    if (!o) return null;
    return tx.obligation.update({
      where: { id },
      data: { status: 'done', settledAt: new Date() },
    });
  });
}

export async function cancelObligation(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const o = await tx.obligation.findFirst({ where: { id, userId } });
    if (!o) return null;
    return tx.obligation.update({ where: { id }, data: { status: 'cancelled' } });
  });
}

/** Топ-N открытых по близости срока — для enrichment мозга. */
export async function openObligationsForContext(userId: string, limit = 5) {
  return prisma.obligation.findMany({
    where: { userId, status: 'open' },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });
}
