import { fuzzyNameRank } from '../../lib/fuzzy.js';
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
  const base = {
    userId,
    status: opts.status ?? 'open',
    ...(opts.direction ? { direction: opts.direction } : {}),
  };
  const query = (personName?: string) =>
    prisma.obligation.findMany({
      where: { ...base, ...(personName ? { personName: { contains: personName, mode: 'insensitive' as const } } : {}) },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
  const rows = await query(opts.personName);
  if (rows.length > 0 || !opts.personName) return rows;
  // «Что я должен Сирику?» — точного имени нет: самый похожий человек по кусочкам
  // букв (в ответе его настоящее имя — мозг скажет «у Серика…»).
  const people = await prisma.obligation.findMany({ where: base, select: { personName: true }, distinct: ['personName'], take: 500 });
  const best = fuzzyNameRank(opts.personName, people, (p) => p.personName, 1)[0];
  return best ? query(best.item.personName) : rows;
}

/**
 * Закрыть (выполнено) — атомарно с проверкой ownership (паттерн tasks DELETE).
 *
 * Аудит 2026-11-09: частичный возврат («вернул 200к из 500к») — paidAmount меньше
 * долга: долг уменьшается и остаётся открытым (раньше закрывался целиком и
 * предлагался доход на всю сумму). Уже закрытый/отменённый — alreadyClosed, без
 * повторного «записать доход».
 */
export async function settleObligation(userId: string, id: string, opts: { paidAmount?: number } = {}) {
  return prisma.$transaction(async (tx) => {
    const o = await tx.obligation.findFirst({ where: { id, userId } });
    if (!o) return null;
    if (o.status !== 'open') return { ...o, paid: 0, remaining: 0, alreadyClosed: true as const };
    const paid = opts.paidAmount;
    if (o.kind === 'money' && o.amount != null && paid != null && paid > 0 && paid < o.amount) {
      const remaining = Math.round((o.amount - paid) * 100) / 100;
      const stamp = new Date().toISOString().slice(0, 10);
      const updated = await tx.obligation.update({
        where: { id },
        data: { amount: remaining, note: [o.note, `${stamp}: вернули ${paid} из ${o.amount}`].filter(Boolean).join('; ') },
      });
      return { ...updated, paid, remaining, alreadyClosed: false as const };
    }
    const updated = await tx.obligation.update({
      where: { id },
      data: { status: 'done', settledAt: new Date() },
    });
    return { ...updated, paid: o.amount ?? 0, remaining: 0, alreadyClosed: false as const };
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
