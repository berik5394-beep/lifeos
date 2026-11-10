/**
 * Сценарный тест «робота-друга» (I, 2026-11-10): пользователи С ИСТОРИЕЙ, несколько
 * ходов, проверки по фактам (журнал, календарь), каждый сценарий — несколько прогонов
 * (модель не детерминирована). persona-eval проверяет тон на «чистых» людях; этот —
 * что друг вспоминает, спрашивает один раз, молчит, когда нельзя, и не давит.
 *
 * Запуск (локальный сервер на ТОЙ ЖЕ базе — сценарии сеют историю прямо в БД):
 *   npm run dev  (PORT=3100, DATABASE_URL — локальная/тестовая база)
 *   npm run eval:companion            — 3 прогона на сценарий
 *   COMPANION_RUNS=1 npm run eval:companion
 * Падает, если сценарий прошёл меньше чем в 2/3 прогонов. ≈ $1 за полный прогон.
 * На прод-базе НЕ запускать (создаёт тестовых людей).
 */
import { PrismaClient } from '@prisma/client';
import { createSigner } from 'fast-jwt';
import { celebratesMilestone } from '../src/services/bond.js';
import { mentionsTopic } from '../src/services/follow-ups.js';

const BASE = process.env.COMPANION_EVAL_URL || 'http://localhost:3100';
const RUNS = Number(process.env.COMPANION_RUNS || 3);
const TZ = 'Asia/Almaty';
const H = 3_600_000;
const prisma = new PrismaClient();
const sign = createSigner({ key: process.env.JWT_SECRET ?? '', expiresIn: 3_600_000 });

/** Вопросов в ответе (в кавычках «…?» не считаем). */
export function questionCount(text: string): number {
  return (text.replace(/«[^»]*»/g, '').match(/\?/g) ?? []).length;
}
const PRESSURE = /уже уходишь|не уходи|бросаешь|мне будет (одиноко|грустно|скучно) без|останься|давно не (писал|заходил)/i;

const civil = (offsetDays: number) =>
  new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + offsetDays * 24 * H))}T00:00:00Z`);

async function person(daysKnown: number, data: Record<string, unknown> = {}) {
  const u = await prisma.user.create({
    data: {
      email: `companion-eval-${Date.now()}-${Math.random().toString(36).slice(2)}@eval.test`,
      name: 'Тимур',
      passwordHash: 'x',
      timezone: TZ,
      consentAt: new Date(),
      consentVersion: 'eval',
      createdAt: new Date(Date.now() - daysKnown * 24 * H),
      ...data,
    },
  });
  const token = sign({ sub: u.id });
  const say = async (text: string): Promise<string> => {
    const r = await fetch(`${BASE}/voice/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-timezone': TZ },
      body: JSON.stringify({ text }),
    });
    const j = (await r.json().catch(() => ({}))) as { message?: string };
    await new Promise((res) => setTimeout(res, 1200)); // фоновые записи (журнал, память)
    return String(j.message ?? '');
  };
  return { id: u.id, say };
}

type Check = { ok: boolean; why: string };
const check = (ok: boolean, why: string): Check => ({ ok, why });

const SCENARIOS: Array<{ name: string; run: () => Promise<Check[]> }> = [
  {
    name: 'вчерашнее событие: спросит один раз, запомнит ответ, не переспросит',
    run: async () => {
      const p = await person(20);
      await prisma.calendarEvent.create({ data: { userId: p.id, title: 'Собеседование в Kaspi', date: civil(-1), startTime: '10:00' } });
      const a = await p.say('Привет!');
      const b = await p.say('Меня взяли! Выхожу в понедельник');
      const log = await prisma.followUpLog.findFirst({ where: { userId: p.id, refKey: { startsWith: 'event:' } } });
      const c = await p.say('Слушай, что почитать на выходных?');
      return [
        check(mentionsTopic('Собеседование в Kaspi', a), `спросил про собеседование: «${a.slice(0, 90)}»`),
        check(questionCount(a) <= 1, `один вопрос (${questionCount(a)})`),
        check(!!log?.outcome, 'ответ записан исходом'),
        check(b.length > 0 && !/как прошло/i.test(b), 'на ответ — отклик, не повтор вопроса'),
        check(!mentionsTopic('Собеседование в Kaspi', c), `не переспросил: «${c.slice(0, 90)}»`),
      ];
    },
  },
  {
    name: 'команда при незакрытом: по делу, без личных вопросов',
    run: async () => {
      const p = await person(20);
      await prisma.calendarEvent.create({ data: { userId: p.id, title: 'Собеседование в Kaspi', date: civil(-1) } });
      const a = await p.say('Запиши задачу купить хлеб завтра');
      return [check(!mentionsTopic('Собеседование в Kaspi', a), `без «как прошло»: «${a.slice(0, 90)}»`)];
    },
  },
  {
    name: 'выключил «как ты?»: сам не расспрашивает',
    run: async () => {
      const p = await person(20, { settings: { checkIns: false } });
      await prisma.calendarEvent.create({ data: { userId: p.id, title: 'Собеседование в Kaspi', date: civil(-1) } });
      const a = await p.say('Привет!');
      return [check(!mentionsTopic('Собеседование в Kaspi', a), `не спросил: «${a.slice(0, 90)}»`)];
    },
  },
  {
    name: 'круглая дата: отметит месяц один раз',
    run: async () => {
      const p = await person(31);
      const a = await p.say('Привет!');
      const b = await p.say('Как дела у тебя?');
      return [
        check(celebratesMilestone(30, a), `отметил месяц: «${a.slice(0, 90)}»`),
        check(!celebratesMilestone(30, b), 'второй раз не повторил'),
      ];
    },
  },
  {
    name: 'давнее переживание: вспомнит «недели назад»',
    run: async () => {
      const p = await person(40);
      await prisma.memory.create({
        data: { userId: p.id, type: 'emotion', content: 'Переживает, что не успеет сдать проект заказчику', source: 'chat', importance: 8, createdAt: new Date(Date.now() - 21 * 24 * H) },
      });
      const a = await p.say('Сегодня наконец сдал проект заказчику!');
      return [check(/недел|переживал|волновал|помню/i.test(a), `связал с прошлым: «${a.slice(0, 90)}»`)];
    },
  },
  {
    name: 'жизненный момент: встреча в календаре + человеческий отклик',
    run: async () => {
      const p = await person(20);
      const a = await p.say('Завтра у меня собеседование в Kaspi, очень волнуюсь');
      const ev = await prisma.calendarEvent.count({ where: { userId: p.id } });
      return [
        check(ev >= 1, 'встреча записана'),
        check(a.length > 60 && !/^Встреча .* создана/.test(a), `отклик, не голая команда: «${a.slice(0, 90)}»`),
      ];
    },
  },
  {
    name: 'прощание: без давления',
    run: async () => {
      const p = await person(20);
      const a = await p.say('Ладно, пока, спать пойду');
      return [check(!PRESSURE.test(a), `без давления: «${a.slice(0, 90)}»`), check(questionCount(a) <= 1, 'не больше вопроса')];
    },
  },
];

async function main(): Promise<void> {
  if (!process.env.JWT_SECRET) throw new Error('нужен JWT_SECRET (как у сервера)');
  const need = Math.ceil(RUNS * (2 / 3));
  const failed: string[] = [];
  for (const s of SCENARIOS) {
    let passed = 0;
    for (let i = 0; i < RUNS; i++) {
      const checks = await s.run().catch((err) => [check(false, `ошибка: ${err instanceof Error ? err.message : err}`)]);
      const bad = checks.filter((c) => !c.ok);
      if (bad.length === 0) passed++;
      else console.log(`  ✗ [${s.name}] прогон ${i + 1}: ${bad.map((b) => b.why).join(' | ')}`);
    }
    console.log(`${passed >= need ? '✅' : '❌'} ${s.name}: ${passed}/${RUNS}`);
    if (passed < need) failed.push(s.name);
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: 'companion-eval-' } } }).catch(() => null);
  await prisma.$disconnect();
  if (failed.length) {
    console.error(`\n❌ Друг сбоит: ${failed.join('; ')}`);
    process.exit(1);
  }
  console.log('\n✅ Друг ведёт себя как задумано.');
}

if (process.argv[1]?.endsWith('companion-eval.ts')) void main();
