import { prisma } from '../lib/prisma.js';

/**
 * Аудит 2026-11-09: лимит бюджета хранится по (категория, месяц, год) и в новый
 * месяц не переходил — 1-го числа предупреждения, пуши и советы молча
 * выключались, хотя робот обещал «предупрежу, если начнёшь превышать».
 *
 * Лимит — «пока не поменяешь»: для категорий без строки в этом месяце берём
 * последний более ранний лимит и материализуем его строкой этого месяца
 * (идемпотентно, skipDuplicates). Явно поставленный в этом месяце (в т.ч. 0)
 * не трогаем. Сбой — молча: читатель лимитов работает как раньше.
 */
export async function carryBudgetLimits(userId: string, month: number, year: number): Promise<void> {
  try {
    const earlier = await prisma.budgetLimit.findMany({
      where: { userId, OR: [{ year: { lt: year } }, { year, month: { lt: month } }] },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { category: true, monthlyLimit: true },
    });
    if (earlier.length === 0) return;
    const have = new Set(
      (await prisma.budgetLimit.findMany({ where: { userId, month, year }, select: { category: true } })).map((r) => r.category),
    );
    const latest = new Map<string, number>();
    for (const r of earlier) if (!latest.has(r.category)) latest.set(r.category, r.monthlyLimit);
    const data = [...latest]
      .filter(([category]) => !have.has(category))
      .map(([category, monthlyLimit]) => ({ userId, category, monthlyLimit, month, year }));
    if (data.length > 0) await prisma.budgetLimit.createMany({ data, skipDuplicates: true });
  } catch (e) {
    console.warn('[budget-carry] failed', userId, e instanceof Error ? e.message : e);
  }
}
