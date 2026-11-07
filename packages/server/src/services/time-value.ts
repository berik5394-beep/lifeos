/**
 * «Время = деньги и команда» (docs/plan/jarvis-roadmap.md №3). Джарвис:
 * «Это совещание стоит 2 часа твоего времени — отдай Айгуль».
 *
 * Цена часа: названная пользователем (settings.hourRate, инструмент
 * set_hour_rate) — или ОЦЕНКА по доходу за 3 месяца (честно помечаем
 * «примерно»). Ни того ни другого — про деньги времени молчим.
 * Команда: люди с типом 'team' и ролью (set_person_type). Задачу «по части»
 * человека узнаём по словам роли — без выдумок: нет совпадения — нет подсказки.
 */
import { prisma } from '../lib/prisma.js';

const DAY = 86_400_000;
/** Рабочих часов в месяце для оценки цены часа по доходу. */
export const WORK_HOURS_PER_MONTH = 160;
/** Встреча короче — о цене не говорим. */
export const LONG_MEETING_MIN = 90;

export interface HourRate {
  rate: number;
  source: 'set' | 'income';
}

export interface TeamMember {
  name: string;
  role: string;
}

export const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} ₸`;

/** Цена часа из настроек; нет — по доходу за 90 дней; нет дохода — null. */
export async function getHourRate(userId: string, now: Date = new Date()): Promise<HourRate | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
  const set = (user?.settings as Record<string, unknown> | null)?.hourRate;
  if (typeof set === 'number' && Number.isFinite(set) && set > 0) return { rate: Math.round(set), source: 'set' };
  const income = await prisma.income.aggregate({
    where: { userId, date: { gte: new Date(now.getTime() - 90 * DAY), lte: now } },
    _sum: { amount: true },
  });
  const sum = income._sum.amount ?? 0;
  if (sum <= 0) return null;
  // Округляем до 500 ₸: оценка, а не бухгалтерия.
  const rate = Math.round(sum / 3 / WORK_HOURS_PER_MONTH / 500) * 500;
  return rate > 0 ? { rate, source: 'income' } : null;
}

const HHMM = /^(\d{1,2}):(\d{2})$/;
function toMinutes(s: string): number {
  const m = s.trim().match(HHMM);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** Длительность события в минутах ('HH:MM'–'HH:MM'); нет конца/ерунда — null. */
export function durationMin(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const d = toMinutes(end) - toMinutes(start);
  return Number.isFinite(d) && d > 0 ? d : null;
}

const hoursText = (min: number) => {
  const h = Math.round((min / 60) * 2) / 2; // до получаса
  const s = Number.isInteger(h) ? String(h) : String(h).replace('.', ',');
  return `${s} ч`;
};

/** «Совещание» — 2 ч ≈ 40 000 ₸ твоего времени. Короткая встреча / нет цены часа — null. */
export function meetingCostLine(title: string, minutes: number | null, rate: HourRate | null): string | null {
  if (!rate || !minutes || minutes < LONG_MEETING_MIN) return null;
  const cost = (minutes / 60) * rate.rate;
  const approx = rate.source === 'income' ? ' (примерно, по доходу)' : '';
  return `«${title}» — ${hoursText(minutes)} ≈ ${money(cost)} твоего времени${approx}. Нужно ли тебе там быть всё время?`;
}

/** Команда: люди с типом team; роль из attributes.role. */
export async function listTeam(userId: string): Promise<TeamMember[]> {
  const rows = await prisma.entity.findMany({
    where: { userId, type: 'person', attributes: { path: ['personType'], equals: 'team' } },
    select: { name: true, attributes: true },
    take: 30,
  });
  return rows.map((r) => {
    const role = (r.attributes as Record<string, unknown> | null)?.role;
    return { name: r.name, role: typeof role === 'string' ? role.trim() : '' };
  });
}

/** Слова-признаки задач по роли (основы, нижний регистр, ё→е). */
const ROLE_HINTS: Array<{ role: RegExp; stems: string[] }> = [
  { role: /бухгалт|финанс|экономист/, stems: ['бухгалт', 'налог', 'акт свер', 'акты свер', 'сверк', 'сверить акт', 'счет-фактур', 'счет фактур', 'зарплатн', 'отчетн', 'декларац', 'ндс'] },
  { role: /продаж|sales/, stems: ['продаж', 'клиент', 'коммерческ', ' кп ', 'лид', 'холодн'] },
  { role: /юрист|юрид|lawyer/, stems: ['договор', 'юрид', 'претенз', ' иск', 'доверенност'] },
  { role: /дизайн/, stems: ['дизайн', 'макет', 'баннер', 'логотип', 'презентац'] },
  { role: /программист|разработ|developer|айти/, stems: ['сайт', ' баг', ' код', 'приложени', 'сервер', ' бот'] },
  { role: /маркет|smm|реклам/, stems: ['реклам', 'smm', 'таргет', ' пост', 'сторис', 'контент'] },
  { role: /ассистент|секретар|помощни/, stems: ['забронир', 'записать', 'заказать', 'купить билет', 'созвон'] },
  { role: /закуп|снабж|логист/, stems: ['закуп', 'поставщик', 'доставк', 'склад', 'заказ товар'] },
];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Слова самой роли (≥5 букв → первые 6) плюс признаки из ROLE_HINTS. */
function roleStems(role: string): string[] {
  const r = norm(role);
  const own = r
    .split(/[^a-zа-я]+/)
    .filter((w) => w.length >= 5)
    .map((w) => w.slice(0, 6));
  const hinted = ROLE_HINTS.filter((h) => h.role.test(r)).flatMap((h) => h.stems);
  return [...new Set([...own, ...hinted])];
}

/**
 * Какие задачи «по части» кого из команды. Задача с именем человека
 * («попросить Айгуль…») — тоже его. Не больше `max` подсказок, по задаче — одна.
 */
export function delegationHints(
  tasks: string[],
  team: TeamMember[],
  max = 2,
): Array<{ task: string; member: TeamMember }> {
  const out: Array<{ task: string; member: TeamMember }> = [];
  for (const task of tasks) {
    const t = ` ${norm(task)} `;
    const member = team.find((m) => {
      const first = norm(m.name).split(' ')[0];
      if (first.length >= 3 && t.includes(` ${first.slice(0, Math.max(3, first.length - 1))}`)) return true;
      return m.role !== '' && roleStems(m.role).some((st) => t.includes(st));
    });
    if (member) out.push({ task, member });
    if (out.length >= max) break;
  }
  return out;
}

/** «Сверить акты» — по части Айгуль (бухгалтер). Передать? */
export function delegationLine(h: { task: string; member: TeamMember }): string {
  const role = h.member.role ? ` (${h.member.role})` : '';
  return `«${h.task}» — по части ${h.member.name}${role}. Передать?`;
}

/** Строки для контекста мозга: цена часа и команда (пусто — нет строк). */
export function timeValueContextLines(rate: HourRate | null, team: TeamMember[]): string[] {
  const out: string[] = [];
  if (rate) {
    out.push(
      rate.source === 'set'
        ? `Цена часа пользователя: ${money(rate.rate)} (названа им).`
        : `Цена часа пользователя: примерно ${money(rate.rate)} (оценка по доходу за 3 месяца; уточни, если важно).`,
    );
  }
  if (team.length > 0) {
    out.push(`Команда пользователя: ${team.map((m) => (m.role ? `${m.name} — ${m.role}` : m.name)).join('; ')}.`);
  }
  return out;
}
