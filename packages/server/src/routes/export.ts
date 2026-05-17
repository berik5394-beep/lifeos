import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { calculateStreak } from '../services/streak-service.js';
import PDFDocument from 'pdfkit';
import { join } from 'node:path';

// A.6: реальный экспорт. Раньше /export/pdf и /export/story
// возвращали JSON («success»), а файла не было — обман. Теперь —
// настоящий PDF (pdfkit + кириллический DejaVuSans) и настоящая
// картинка-Story (SVG, вектор, без native-deps).

const FONT_PATH = join(process.cwd(), 'assets', 'DejaVuSans.ttf');

interface ReportData {
  period: string;
  startDate: string;
  endDate: string;
  tasks: { total: number; completed: number; completionRate: number };
  habits: { activeCount: number; totalCompletions: number };
  finance: {
    totalExpenses: number;
    totalIncomes: number;
    balance: number;
    topCategories: { category: string; amount: number }[];
  };
}

export function renderReportPdf(rd: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    // Кириллица: pdfkit-Helvetica её не умеет → встроенный DejaVuSans.
    // Если файла нет (локальный запуск без assets) — дефолтный шрифт,
    // PDF всё равно валиден (не падаем).
    try {
      doc.font(FONT_PATH);
    } catch {
      /* fallback: встроенный шрифт pdfkit */
    }
    doc.fontSize(22).fillColor('#0F172A').text('LifeOS — отчёт', { align: 'center' });
    doc.moveDown(0.4);
    doc
      .fontSize(11)
      .fillColor('#64748B')
      .text(
        `Период: ${rd.period === 'month' ? 'месяц' : 'год'} (${rd.startDate} — ${rd.endDate})`,
        { align: 'center' },
      );
    doc.moveDown(1.5);

    const section = (title: string, lines: string[]) => {
      doc.fillColor('#0F172A').fontSize(15).text(title);
      doc.moveDown(0.2).fillColor('#334155').fontSize(12);
      for (const l of lines) doc.text(l);
      doc.moveDown(1);
    };

    section('Задачи', [
      `Выполнено ${rd.tasks.completed} из ${rd.tasks.total} (${rd.tasks.completionRate}%)`,
    ]);
    section('Привычки', [
      `Активных: ${rd.habits.activeCount}`,
      `Отметок за период: ${rd.habits.totalCompletions}`,
    ]);
    section('Финансы', [
      `Доходы: ${Math.round(rd.finance.totalIncomes)} ₸`,
      `Расходы: ${Math.round(rd.finance.totalExpenses)} ₸`,
      `Баланс: ${Math.round(rd.finance.balance)} ₸`,
    ]);
    if (rd.finance.topCategories.length > 0) {
      section(
        'Топ категорий трат',
        rd.finance.topCategories.map(
          (c) => `— ${c.category}: ${Math.round(c.amount)} ₸`,
        ),
      );
    }
    doc
      .moveDown(1)
      .fontSize(9)
      .fillColor('#94A3B8')
      .text('Сгенерировано LifeOS', { align: 'center' });
    doc.end();
  });
}

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;',
  );
}

/** Story 1080×1920 как настоящая картинка (SVG-вектор, без canvas). */
export function renderStorySvg(
  title: string,
  rows: { label: string; value: string }[],
): string {
  const items = rows
    .map(
      (r, i) =>
        `<text x="90" y="${760 + i * 150}" font-size="40" fill="#94A3B8">${esc(r.label)}</text>` +
        `<text x="990" y="${760 + i * 150}" font-size="56" fill="#F8FAFC" font-weight="bold" text-anchor="end">${esc(r.value)}</text>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0F172A"/><stop offset="1" stop-color="#1E293B"/>
  </linearGradient></defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <text x="540" y="420" font-size="64" fill="#6366F1" font-weight="bold" text-anchor="middle" font-family="sans-serif">LifeOS</text>
  <text x="540" y="540" font-size="48" fill="#F8FAFC" text-anchor="middle" font-family="sans-serif">${esc(title)}</text>
  <g font-family="sans-serif">${items}</g>
  <text x="540" y="1830" font-size="32" fill="#475569" text-anchor="middle" font-family="sans-serif">lifeos.app</text>
</svg>`;
}

const pdfReportSchema = z.object({
  period: z.enum(['month', 'year']),
  date: z.string().optional(),
});

function escapeCsvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const headerLine = headers.map(escapeCsvField).join(',');
  const dataLines = rows.map((row) => row.map(escapeCsvField).join(','));
  return [headerLine, ...dataLines].join('\n');
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // --- Export CSV ---

  app.post('/export/csv/:module', async (request, reply) => {
    const { module } = request.params as { module: string };
    const userId = request.userId;

    let csv: string;

    switch (module) {
      case 'finance': {
        const [expenses, incomes] = await Promise.all([
          prisma.expense.findMany({
            where: { userId },
            orderBy: { date: 'desc' },
          }),
          prisma.income.findMany({
            where: { userId },
            orderBy: { date: 'desc' },
          }),
        ]);

        const headers = ['Тип', 'Дата', 'Категория/Источник', 'Описание', 'Сумма'];
        const rows: (string | number | boolean | null)[][] = [
          ...expenses.map((e) => [
            'Расход' as string,
            e.date.toISOString().split('T')[0],
            e.category,
            e.description,
            -e.amount,
          ]),
          ...incomes.map((i) => [
            'Доход' as string,
            i.date.toISOString().split('T')[0],
            i.source,
            '' as string,
            i.amount,
          ]),
        ];

        csv = toCsv(headers, rows);
        break;
      }

      case 'habits': {
        const habits = await prisma.habit.findMany({
          where: { userId },
          include: {
            logs: {
              where: { completed: true },
              orderBy: { date: 'desc' },
            },
          },
        });

        const headers = ['Привычка', 'Категория', 'Частота', 'Активна', 'Дата выполнения', 'Авто'];
        const rows: (string | number | boolean | null)[][] = [];

        for (const habit of habits) {
          if (habit.logs.length === 0) {
            rows.push([habit.name, habit.category, habit.frequency, habit.active ? 'Да' : 'Нет', '', '']);
          } else {
            for (const log of habit.logs) {
              rows.push([
                habit.name,
                habit.category,
                habit.frequency,
                habit.active ? 'Да' : 'Нет',
                log.date.toISOString().split('T')[0],
                log.autoCompleted ? 'Да' : 'Нет',
              ]);
            }
          }
        }

        csv = toCsv(headers, rows);
        break;
      }

      case 'tasks': {
        const tasks = await prisma.task.findMany({
          where: { userId },
          orderBy: { date: 'desc' },
        });

        const headers = ['Задача', 'Категория', 'Приоритет', 'Дата', 'Время', 'Выполнена', 'Заметки'];
        const rows = tasks.map((t) => [
          t.title,
          t.category,
          t.priority,
          t.date.toISOString().split('T')[0],
          t.time ?? '',
          t.completed ? 'Да' : 'Нет',
          t.notes ?? '',
        ]);

        csv = toCsv(headers, rows);
        break;
      }

      default:
        return reply.status(400).send({
          message: `Неподдерживаемый модуль: ${module}. Доступны: finance, habits, tasks`,
        });
    }

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${module}_export.csv"`)
      .send(csv);
  });

  // --- PDF Report ---

  app.post('/export/pdf/report', {
    preHandler: validate(pdfReportSchema),
  }, async (request, reply) => {
    const { period, date } = request.body as z.infer<typeof pdfReportSchema>;
    const userId = request.userId;

    const refDate = date ? new Date(date) : new Date();
    let startDate: Date;
    let endDate: Date;

    if (period === 'month') {
      startDate = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
      endDate = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 1);
    } else {
      startDate = new Date(refDate.getFullYear(), 0, 1);
      endDate = new Date(refDate.getFullYear() + 1, 0, 1);
    }

    const [
      tasks,
      completedTasks,
      habitLogs,
      activeHabits,
      expenseTotal,
      incomeTotal,
      topExpenses,
    ] = await Promise.all([
      prisma.task.count({
        where: { userId, date: { gte: startDate, lt: endDate } },
      }),
      prisma.task.count({
        where: { userId, date: { gte: startDate, lt: endDate }, completed: true },
      }),
      prisma.habitLog.count({
        where: { userId, date: { gte: startDate, lt: endDate }, completed: true },
      }),
      prisma.habit.count({
        where: { userId, active: true },
      }),
      prisma.expense.aggregate({
        where: { userId, date: { gte: startDate, lt: endDate } },
        _sum: { amount: true },
      }),
      prisma.income.aggregate({
        where: { userId, date: { gte: startDate, lt: endDate } },
        _sum: { amount: true },
      }),
      prisma.expense.groupBy({
        by: ['category'],
        where: { userId, date: { gte: startDate, lt: endDate } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 5,
      }),
    ]);

    const totalExpenses = expenseTotal._sum.amount ?? 0;
    const totalIncomes = incomeTotal._sum.amount ?? 0;

    const reportData = {
      period,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      tasks: {
        total: tasks,
        completed: completedTasks,
        completionRate: tasks > 0 ? Math.round((completedTasks / tasks) * 100) : 0,
      },
      habits: {
        activeCount: activeHabits,
        totalCompletions: habitLogs,
      },
      finance: {
        totalExpenses,
        totalIncomes,
        balance: totalIncomes - totalExpenses,
        topCategories: topExpenses.map((e) => ({
          category: e.category,
          amount: e._sum.amount ?? 0,
        })),
      },
    };

    const pdf = await renderReportPdf(reportData);
    return reply
      .header('Content-Type', 'application/pdf')
      .header(
        'Content-Disposition',
        `attachment; filename="lifeos-report-${reportData.startDate}.pdf"`,
      )
      .send(pdf);
  });

  // --- Instagram Story Data ---

  app.post('/export/story', async (request, reply) => {
    const userId = request.userId;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const [
      todayTasks,
      todayCompletedTasks,
      weekTasks,
      weekCompletedTasks,
      todayHabitLogs,
      activeHabits,
      todaySteps,
    ] = await Promise.all([
      prisma.task.count({
        where: { userId, date: today },
      }),
      prisma.task.count({
        where: { userId, date: today, completed: true },
      }),
      prisma.task.count({
        where: { userId, date: { gte: weekStart, lt: weekEnd } },
      }),
      prisma.task.count({
        where: { userId, date: { gte: weekStart, lt: weekEnd }, completed: true },
      }),
      prisma.habitLog.count({
        where: { userId, date: today, completed: true },
      }),
      prisma.habit.count({
        where: { userId, active: true },
      }),
      prisma.stepLog.findUnique({
        where: { userId_date: { userId, date: today } },
        select: { steps: true, distanceKm: true },
      }),
    ]);

    // Streak — delegated to streak-service (single findMany vs 365 counts)
    const streak = await calculateStreak(userId);

    const svg = renderStorySvg('Мой прогресс', [
      { label: 'Задачи сегодня', value: `${todayCompletedTasks}/${todayTasks}` },
      { label: 'Задачи за неделю', value: `${weekCompletedTasks}/${weekTasks}` },
      { label: 'Привычки сегодня', value: `${todayHabitLogs}/${activeHabits}` },
      { label: 'Серия', value: `${streak} дн` },
      { label: 'Шаги сегодня', value: `${todaySteps?.steps ?? 0}` },
    ]);
    return reply
      .header('Content-Type', 'image/svg+xml; charset=utf-8')
      .header('Content-Disposition', 'inline; filename="lifeos-story.svg"')
      .send(svg);
  });
}
