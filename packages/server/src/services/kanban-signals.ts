/**
 * Канбан в мозгу. Две вещи:
 *  1. Синхронизация «галочка ⇄ колонка Готово» — одно правило на все пути записи
 *     (приложение, голос, канбан), чтобы доска и список задач не расходились.
 *  2. READ-ONLY сигналы доски для мозга: сколько дел «В работе» и что там
 *     зависло. Числа — только из БД (идут в бриф и в контекст чата под гардом честности).
 */
import { prisma } from '../lib/prisma.js';

export const KANBAN_LABELS: Record<string, string> = {
  backlog: 'Бэклог',
  todo: 'К выполнению',
  in_progress: 'В работе',
  done: 'Готово',
};

/** Больше — внимание расползается: лучше закончить одно, чем начать пятое. */
export const KANBAN_WIP_LIMIT = 3;
/** Столько дней в «В работе» без движения — задача зависла. */
export const KANBAN_STUCK_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export function kanbanLabel(status: string): string {
  return KANBAN_LABELS[status] ?? status;
}

/**
 * Поля задачи при смене выполненности. Отметил выполненной → «Готово»;
 * снял отметку с задачи из «Готово» → обратно «К выполнению».
 * Иначе (снял отметку, а задача и так не в «Готово») — колонку не трогаем.
 */
export function kanbanForCompletion(
  completed: boolean,
  currentStatus: string,
  now: Date = new Date(),
): { kanbanStatus: string; kanbanMovedAt: Date } | Record<string, never> {
  if (completed && currentStatus !== 'done') return { kanbanStatus: 'done', kanbanMovedAt: now };
  if (!completed && currentStatus === 'done') return { kanbanStatus: 'todo', kanbanMovedAt: now };
  return {};
}

export interface KanbanSignals {
  inProgress: number;
  /** Зависшие в «В работе» (самые старые первыми), не больше 3. */
  stuck: { title: string; days: number }[];
}

type InProgressRow = { title: string; kanbanMovedAt: Date | null };

/** Чистое ядро: из строк «В работе» → сигналы. kanbanMovedAt = NULL → срок неизвестен, не «завис». */
export function computeKanbanSignals(rows: InProgressRow[], now: Date = new Date()): KanbanSignals {
  const stuck = rows
    .filter((r) => r.kanbanMovedAt && now.getTime() - r.kanbanMovedAt.getTime() >= KANBAN_STUCK_DAYS * DAY_MS)
    .map((r) => ({ title: r.title, days: Math.floor((now.getTime() - (r.kanbanMovedAt as Date).getTime()) / DAY_MS) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 3);
  return { inProgress: rows.length, stuck };
}

export async function gatherKanbanSignals(userId: string, now: Date = new Date()): Promise<KanbanSignals> {
  const rows = await prisma.task.findMany({
    where: { userId, kanbanStatus: 'in_progress', completed: false, cancelled: false },
    select: { title: true, kanbanMovedAt: true },
    take: 50,
  });
  return computeKanbanSignals(rows, now);
}

/** Факты доски для брифа и контекста чата. Пусто — если на доске всё спокойно. */
export function formatKanbanFacts(s: KanbanSignals): string[] {
  const out: string[] = [];
  if (s.inProgress > KANBAN_WIP_LIMIT) {
    out.push(`в работе на канбане ${s.inProgress} задач одновременно (больше ${KANBAN_WIP_LIMIT}) — лучше закончить одну, прежде чем брать новую`);
  }
  for (const t of s.stuck) {
    out.push(`задача «${t.title}» висит «В работе» ${t.days} дн. без движения`);
  }
  return out;
}
