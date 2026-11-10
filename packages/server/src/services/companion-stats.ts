/**
 * Счётчики «робота-друга» за день (J, 2026-11-10) — в утреннюю сводку: работает
 * ли то, что сделали, на живых людях. Сутки — UTC, как у остальной сводки.
 */
import { prisma } from '../lib/prisma.js';

export interface CompanionStats {
  offered: number;
  asked: number;
  answered: number;
  milestones: number;
  diaries: number;
  checkIns: number;
}

export async function companionStats(day: string): Promise<CompanionStats> {
  const from = new Date(`${day}T00:00:00Z`);
  const to = new Date(from.getTime() + 86_400_000);
  const range = { gte: from, lt: to };
  const [offered, asked, answered, milestones, diaries, checkIns] = await Promise.all([
    prisma.followUpLog.count({ where: { offeredAt: range, NOT: { refKey: { startsWith: 'milestone:' } } } }),
    prisma.followUpLog.count({ where: { askedAt: range, NOT: { refKey: { startsWith: 'milestone:' } } } }),
    prisma.followUpLog.count({ where: { answeredAt: range } }),
    prisma.followUpLog.count({ where: { closedAt: range, askedAt: { not: null }, refKey: { startsWith: 'milestone:' } } }),
    prisma.robotDiaryEntry.count({ where: { createdAt: range } }),
    prisma.insight.count({ where: { kind: 'v2_nudge', scopeKey: { startsWith: 'check_in:' }, createdAt: range } }),
  ]);
  return { offered, asked, answered, milestones, diaries, checkIns };
}

/** Строка сводки или null, если за день ничего не было (чистая). */
export function companionLine(s: CompanionStats): string | null {
  if (Object.values(s).every((v) => v === 0)) return null;
  const parts = [
    `«как прошло?» спросил ${s.asked}${s.offered ? ` из ${s.offered} предложенных` : ''}, ответили ${s.answered}`,
    s.milestones ? `круглых дат отметил ${s.milestones}` : null,
    `записей дневника ${s.diaries}`,
    `пушей «как ты?» ${s.checkIns}`,
  ].filter(Boolean);
  return `Друг: ${parts.join(', ')}.`;
}
