/**
 * Демо-аккаунт для проверяющего App Store (и для показа): заполнен всеми
 * функциями — задачи, привычки с историей, цели (год/месяц/неделя), финансы с
 * бюджетом, дневник, шаги, встречи, сделки, память робота, чат, монеты комнаты.
 *
 * Запуск (пароль задаёшь сам, в репо его нет):
 *   локально:  DEMO_PASSWORD='…' npx tsx scripts/seed-demo.ts
 *   прод:      DEMO_PASSWORD='…' ~/.npm-global/bin/railway run -s lifeos-api npx tsx scripts/seed-demo.ts
 *              (берёт DATABASE_PUBLIC_URL — внутренний адрес Railway снаружи недоступен)
 * Email — DEMO_EMAIL (по умолчанию appreview@lifeos.kz). Аккаунт уже есть — ничего не трогает.
 * Даты — от «сегодня» по Алматы: запусти накануне отправки на ревью.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { CONSENT_VERSION } from '../src/legal/legal-text.js';

const TZ = 'Asia/Almaty';
const email = (process.env.DEMO_EMAIL || 'appreview@lifeos.kz').toLowerCase();
const password = process.env.DEMO_PASSWORD || '';
const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;

/** Гражданская дата по Алматы со сдвигом в днях → полночь UTC (для @db.Date). */
function day(offset = 0): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + offset * 86_400_000));
  return new Date(`${ymd}T00:00:00Z`);
}
export async function seedDemo(prisma: PrismaClient, opts: { email: string; password: string }): Promise<{ userId: string; created: boolean }> {
  const existing = await prisma.user.findUnique({ where: { email: opts.email } });
  if (existing) return { userId: existing.id, created: false };

  const today = day(0);
  const user = await prisma.user.create({
    data: {
      email: opts.email,
      name: 'Алия',
      passwordHash: await bcrypt.hash(opts.password, 12),
      assistantStyle: 'friendly',
      assistantGender: 'female',
      wakeUpTime: '07:00',
      timezone: TZ,
      consentAt: new Date(),
      consentVersion: CONSENT_VERSION,
    },
  });
  const userId = user.id;
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric' }).format(new Date()));
  const month = Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, month: 'numeric' }).format(new Date()));
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const dow = (today.getUTCDay() + 6) % 7; // пн = 0
  const weekStart = new Date(today.getTime() - dow * 86_400_000);

  // ── Цели ────────────────────────────────────────────────────────────────
  const [gFinance, gHealth] = await Promise.all([
    prisma.yearlyGoal.create({ data: { userId, year, area: 'finance', goalText: 'Накопить 3 000 000 ₸ на первый взнос', progress: 62 } }),
    prisma.yearlyGoal.create({ data: { userId, year, area: 'health', goalText: 'Пробежать полумарафон', progress: 45 } }),
    prisma.yearlyGoal.create({ data: { userId, year, area: 'career', goalText: 'Запустить своё приложение', progress: 70 } }),
    prisma.yearlyGoal.create({ data: { userId, year, area: 'spirituality', goalText: 'Прочитать 24 книги', progress: 58 } }),
  ]);
  await prisma.monthlyGoal.createMany({
    data: [
      { userId, monthStart, goalText: 'Отложить 250 000 ₸' },
      { userId, monthStart, goalText: 'Пробежать 60 км за месяц' },
    ],
  });
  await prisma.weeklyGoal.createMany({
    data: [
      { userId, weekStart, goalText: 'Сдать отчёт по проекту', completed: true, order: 0 },
      { userId, weekStart, goalText: '3 пробежки', order: 1 },
      { userId, weekStart, goalText: 'Позвонить маме и бабушке', order: 2 },
    ],
  });

  // ── Привычки + 3 недели истории (~75% выполнения) ──────────────────────
  const habitDefs = [
    { name: 'Зарядка 10 минут', category: 'health', goalId: gHealth.id, rate: 0.85 },
    { name: 'Чтение 20 минут', category: 'personal', goalId: null, rate: 0.7 },
    { name: 'Медитация', category: 'personal', goalId: null, rate: 0.6 },
    { name: '2 литра воды', category: 'health', goalId: null, rate: 0.8 },
    { name: 'Без трат на кофе навынос', category: 'personal', goalId: gFinance.id, rate: 0.65 },
  ];
  for (const [i, h] of habitDefs.entries()) {
    const habit = await prisma.habit.create({
      data: { userId, name: h.name, category: h.category, frequency: 'daily', goalId: h.goalId, order: i },
    });
    const logs = [];
    for (let d = 21; d >= 1; d--) {
      // детерминированный «узор» — не случайный, чтобы демо было одинаковым
      const done = ((d * 7 + i * 3) % 10) / 10 < h.rate;
      logs.push({ habitId: habit.id, userId, date: day(-d), completed: done });
    }
    if (i < 2) logs.push({ habitId: habit.id, userId, date: today, completed: true }); // сегодня — 2 из 5
    await prisma.habitLog.createMany({ data: logs });
  }

  // ── Задачи ──────────────────────────────────────────────────────────────
  const T = (offset: number, title: string, category: string, priority: string, extra: Record<string, unknown> = {}) => ({
    userId, title, category, priority, date: day(offset), ...extra,
  });
  await prisma.task.createMany({
    data: [
      T(0, 'Подготовить презентацию для инвестора', 'work', 'high', { time: '11:00', estimatedMinutes: 90 }),
      T(0, 'Оплатить интернет', 'finance', 'medium', { completed: true }),
      T(0, 'Тренировка: лёгкий бег 5 км', 'health', 'medium', { time: '19:00' }),
      T(0, 'Купить продукты на неделю', 'home', 'low', { completed: true }),
      T(0, 'Прочитать главу «Атомных привычек»', 'education', 'low', { time: '22:00' }),
      T(1, 'Созвон с дизайнером по логотипу', 'work', 'high', { time: '10:00' }),
      T(1, 'Записаться к стоматологу', 'health', 'medium'),
      T(2, 'Отправить договор Ержану', 'work', 'critical'),
      T(3, 'Забрать посылку', 'personal', 'low'),
      T(4, 'Разобрать гардероб', 'home', 'low'),
      T(-2, 'Продлить страховку машины', 'finance', 'high'), // просрочена
      ...[-1, -2, -3, -4, -5, -6].map((o, i) =>
        T(o, ['Отчёт за неделю', 'Йога', 'Встреча с бухгалтером', 'Уборка', 'Курс по SQL: урок 4', 'Позвонить маме'][i], ['work', 'health', 'finance', 'home', 'education', 'personal'][i], 'medium', { completed: true }),
      ),
    ],
  });

  // ── Календарь ───────────────────────────────────────────────────────────
  await prisma.calendarEvent.createMany({
    data: [
      { userId, title: 'Встреча с инвестором', date: today, startTime: '15:00', endTime: '16:00', location: 'Кофейня Nomad, Абая 52', reminder: 60 },
      { userId, title: 'Планёрка команды', date: today, startTime: '09:30', endTime: '10:00' },
      { userId, title: 'Ужин с Ержаном', date: day(1), startTime: '19:30', endTime: '21:00', location: 'Ресторан «Дастархан»' },
      { userId, title: 'Футбол с друзьями', date: day(3), startTime: '20:00', endTime: '22:00' },
      { userId, title: 'День рождения мамы', date: day(5), description: 'Купить цветы и торт' },
    ],
  });

  // ── Финансы: этот и прошлый месяц, бюджет, остаток на счетах ────────────
  const thisMonthDays = Math.max(1, today.getUTCDate());
  const ex = (date: Date, category: string, description: string, amount: number) => ({ userId, date, category, description, amount });
  const expenses = [];
  const spread: Array<[string, string, number]> = [
    ['food', 'Magnum — продукты', 18500], ['transport', 'Яндекс Go', 2400], ['food', 'Обед с коллегами', 6500],
    ['entertainment', 'Кино', 5000], ['health', 'Аптека', 4200], ['transport', 'Бензин', 12000],
    ['food', 'Small — продукты', 9800], ['clothing', 'Кроссовки для бега', 42000], ['home', 'Бытовая химия', 7300],
    ['food', 'Кофе', 1800], ['entertainment', 'Подписка на музыку', 1990], ['other', 'Подарок коллеге', 8000],
  ];
  spread.forEach(([cat, desc, amount], i) => {
    const off = -Math.min(thisMonthDays - 1, Math.floor((i * thisMonthDays) / spread.length));
    expenses.push(ex(day(off), cat, desc, amount));
  });
  const prevMonth = (d: number) => new Date(Date.UTC(year, month - 2, d));
  spread.forEach(([cat, desc, amount], i) => expenses.push(ex(prevMonth(2 + i * 2), cat, desc, Math.round(amount * 1.1))));
  await prisma.expense.createMany({ data: expenses });
  await prisma.income.createMany({
    data: [
      { userId, date: new Date(Date.UTC(year, month - 1, 1)), source: 'Зарплата', amount: 450000 },
      { userId, date: prevMonth(1), source: 'Зарплата', amount: 450000 },
      { userId, date: prevMonth(18), source: 'Фриланс: сайт для кафе', amount: 120000 },
    ],
  });
  await prisma.budgetLimit.createMany({
    data: [
      { userId, category: 'food', monthlyLimit: 120000, month, year },
      { userId, category: 'transport', monthlyLimit: 40000, month, year },
      { userId, category: 'entertainment', monthlyLimit: 30000, month, year },
      { userId, category: 'clothing', monthlyLimit: 50000, month, year },
    ],
  });
  await prisma.cashSnapshot.create({ data: { userId, balance: 1860000, asOf: new Date() } });

  // ── Дневник и шаги ──────────────────────────────────────────────────────
  const notes = ['Хороший день, много успела', 'Устала, но пробежка помогла', 'Плохо спала', 'Отличная встреча с командой', null];
  await prisma.journalEntry.createMany({
    data: Array.from({ length: 10 }, (_, k) => ({
      userId, date: day(-(k + 1)), sleepHours: 6 + ((k * 3) % 5) * 0.5, energy: 2 + ((k * 2) % 4), mood: 3 + ((k + 1) % 3), notes: notes[k % notes.length],
    })),
  });
  await prisma.stepLog.createMany({
    data: Array.from({ length: 14 }, (_, k) => ({ userId, date: day(-(k + 1)), steps: 5200 + ((k * 2711) % 7800), distanceKm: null })),
  });

  // ── Сделки ──────────────────────────────────────────────────────────────
  await prisma.deal.create({ data: { userId, personName: 'Ержан', title: 'Мобильное приложение для сети кофеен', amount: 2500000, stage: 'proposal', nextStepAt: day(2), nextStepText: 'Отправить договор' } });
  await prisma.deal.create({ data: { userId, personName: 'Айгерим', title: 'Лендинг для салона', amount: 350000, stage: 'talks', nextStepAt: day(4), nextStepText: 'Созвониться, уточнить сроки' } });
  await prisma.deal.create({ data: { userId, personName: 'Тимур', title: 'Сайт для кафе', amount: 120000, stage: 'won', closedAt: prevMonth(18) } });

  // ── Память робота и чат ─────────────────────────────────────────────────
  const mem = (type: string, content: string, importance = 6) => ({ userId, type, content, source: 'seed-demo', importance });
  await prisma.memory.createMany({
    data: [
      mem('fact', 'Копит на первый взнос за квартиру — цель 3 000 000 ₸ к концу года', 8),
      mem('person', 'Ержан — партнёр по проекту приложения для кофеен', 7),
      mem('person', 'День рождения мамы — через 5 дней, любит пионы', 8),
      mem('preference', 'Любит бегать по вечерам, утро — для важной работы', 6),
      mem('decision', 'Решила не брать кредит на машину, пока не накопит на взнос', 7),
    ],
  });
  const t0 = Date.now() - 2 * 3600_000;
  await prisma.chatMessage.createMany({
    data: [
      { userId, role: 'user', content: 'Как у меня с бюджетом на еду?', createdAt: new Date(t0) },
      { userId, role: 'assistant', content: 'Алия, на еду в этом месяце ушло 36 600 ₸ из 120 000 — идёшь отлично, запас большой. Если так продолжишь, к концу месяца сможешь отложить на взнос ещё тысяч 50.', createdAt: new Date(t0 + 1) },
      { userId, role: 'user', content: 'Что у меня сегодня?', createdAt: new Date(t0 + 60_000) },
      { userId, role: 'assistant', content: 'Сегодня 5 задач, две уже готовы. Главное — презентация для инвестора к 11:00, а в 15:00 сама встреча в Nomad. Вечером лёгкая пробежка.', createdAt: new Date(t0 + 60_001) },
    ],
  });

  // ── Монеты для комнаты робота (обставить самой) ─────────────────────────
  await prisma.coinTransaction.createMany({
    data: [
      { userId, amount: 300, reason: 'Старт', refKey: 'start' },
      { userId, amount: 1200, reason: 'Демо: за выполненные дела', refKey: 'demo-bonus' },
    ],
  });

  return { userId, created: true };
}

async function main(): Promise<void> {
  if (password.length < 8) {
    console.error('Задай пароль: DEMO_PASSWORD=… (минимум 8 символов)');
    process.exit(1);
  }
  if (!url) {
    console.error('Нет DATABASE_PUBLIC_URL / DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const r = await seedDemo(prisma, { email, password });
    console.log(r.created ? `Демо-аккаунт создан: ${email}` : `Уже есть: ${email} — ничего не менял`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('seed-demo.ts')) void main();
