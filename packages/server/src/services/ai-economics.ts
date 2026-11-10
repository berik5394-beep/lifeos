import { companionLine, companionStats } from './companion-stats.js';
import { prisma } from '../lib/prisma.js';
import { SYSTEM_USER } from '../lib/ai-usage.js';

/**
 * Экономика и удержание (Berik 2026-11-09): сколько стоит один человек в день
 * и возвращаются ли люди. Источники: AiUsageDay (токены по моделям),
 * UserActiveDay (кто был в приложении), User.createdAt (когда пришёл).
 */

/** $ за 1M токенов (claude-api skill, 2026-10). Кэш: чтение 0.1×, запись 1.25× входа. */
const CLAUDE_PRICES: Array<{ match: RegExp; input: number; output: number }> = [
  { match: /opus/, input: 5, output: 25 },
  { match: /sonnet/, input: 3, output: 15 },
  { match: /haiku/, input: 1, output: 5 },
];
/** Groq whisper-large-v3-turbo ≈ $0.04 за час звука, минимум 10 с за запрос. */
const WHISPER_PER_CALL_USD = (0.04 / 3600) * 10;

export interface UsageRow {
  userId: string;
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function rowCostUsd(r: UsageRow): number {
  if (r.model.startsWith('error:')) return 0;
  if (r.provider === 'groq') return r.calls * WHISPER_PER_CALL_USD;
  // Неизвестная модель — по цене Sonnet (с запасом, не занижаем).
  const p = CLAUDE_PRICES.find((x) => x.match.test(r.model)) ?? CLAUDE_PRICES[1];
  const perTok = (usd: number) => usd / 1_000_000;
  return (
    r.inputTokens * perTok(p.input) +
    r.cacheReadTokens * perTok(p.input * 0.1) +
    r.cacheWriteTokens * perTok(p.input * 1.25) +
    r.outputTokens * perTok(p.output)
  );
}

export interface DaySummary {
  day: string;
  activeUsers: number;
  newUsers: number;
  /** Модели за день, $: люди + фон. */
  totalUsd: number;
  /** Фон (планировщик, кроны) — делится на всех. */
  systemUsd: number;
  /** total / активные — полная стоимость человека в день. */
  perActiveUserUsd: number | null;
  /** Самый дорогой человек дня, $ (без фона). */
  maxUserUsd: number;
  claudeCalls: number;
  whisperCalls: number;
  failures: Record<string, number>;
  byModel: Record<string, number>;
}

export function summarizeDay(day: string, rows: UsageRow[], activeUsers: number, newUsers: number): DaySummary {
  let totalUsd = 0;
  let systemUsd = 0;
  let claudeCalls = 0;
  let whisperCalls = 0;
  const failures: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  const perUser = new Map<string, number>();
  for (const r of rows) {
    if (r.model.startsWith('error:')) {
      const k = `${r.provider}:${r.model.slice(6)}`;
      failures[k] = (failures[k] ?? 0) + r.calls;
      continue;
    }
    const cost = rowCostUsd(r);
    totalUsd += cost;
    byModel[r.model] = (byModel[r.model] ?? 0) + cost;
    if (r.provider === 'groq') whisperCalls += r.calls;
    else claudeCalls += r.calls;
    if (r.userId === SYSTEM_USER) systemUsd += cost;
    else perUser.set(r.userId, (perUser.get(r.userId) ?? 0) + cost);
  }
  return {
    day,
    activeUsers,
    newUsers,
    totalUsd,
    systemUsd,
    perActiveUserUsd: activeUsers > 0 ? totalUsd / activeUsers : null,
    maxUserUsd: Math.max(0, ...perUser.values()),
    claudeCalls,
    whisperCalls,
    failures,
    byModel,
  };
}

function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayStr(d);
}
const utc = (day: string): Date => new Date(`${day}T00:00:00Z`);

export async function daySummary(day: string): Promise<DaySummary> {
  const [rows, activeUsers, newUsers] = await Promise.all([
    prisma.aiUsageDay.findMany({ where: { day: utc(day) } }),
    prisma.userActiveDay.count({ where: { day: utc(day) } }),
    prisma.user.count({ where: { createdAt: { gte: utc(day), lt: utc(addDays(day, 1)) } } }),
  ]);
  return summarizeDay(day, rows, activeUsers, newUsers);
}

export interface Retention {
  cohortDay: string;
  cohort: number;
  returned: number;
}

/** Удержание: из пришедших в (day − n) сколько были в приложении в day. */
export async function retentionOn(day: string, n: number): Promise<Retention> {
  const cohortDay = addDays(day, -n);
  const cohortUsers = await prisma.user.findMany({
    where: { createdAt: { gte: utc(cohortDay), lt: utc(addDays(cohortDay, 1)) } },
    select: { id: true },
  });
  if (cohortUsers.length === 0) return { cohortDay, cohort: 0, returned: 0 };
  const returned = await prisma.userActiveDay.count({
    where: { day: utc(day), userId: { in: cohortUsers.map((u) => u.id) } },
  });
  return { cohortDay, cohort: cohortUsers.length, returned };
}

const money = (v: number): string => (v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);

/** Сводка уходит в 09:xx по Алматы (UTC+5) = 04:xx UTC. */
export function isOpsDigestHour(now: Date): boolean {
  return now.getUTCHours() === 4;
}

/** Утренняя сводка владельцу: вчерашний день одним сообщением. */
export function digestText(s: DaySummary, d1: Retention, d7: Retention, companion?: string | null): { title: string; body: string } {
  const lines: string[] = [];
  lines.push(`Людей: ${s.activeUsers}${s.newUsers ? ` (новых ${s.newUsers})` : ''}.`);
  lines.push(
    `Модели: ${money(s.totalUsd)}` +
      (s.perActiveUserUsd !== null ? ` — ${money(s.perActiveUserUsd)} на человека` : '') +
      (s.maxUserUsd > 0 ? `, самый дорогой ${money(s.maxUserUsd)}` : '') +
      `. Фон ${money(s.systemUsd)}.`,
  );
  lines.push(`Запросов к Claude: ${s.claudeCalls}, голосовых: ${s.whisperCalls}.`);
  const ret = (r: Retention, label: string): string | null => (r.cohort > 0 ? `${label} ${r.returned} из ${r.cohort}` : null);
  const retParts = [ret(d1, 'на следующий день'), ret(d7, 'через неделю')].filter((x): x is string => x !== null);
  if (retParts.length) lines.push(`Вернулись: ${retParts.join(', ')}.`);
  const fails = Object.entries(s.failures);
  lines.push(fails.length ? `Сбои: ${fails.map(([k, v]) => `${k} ×${v}`).join(', ')}.` : 'Сбоев моделей не было.');
  // J: работает ли «друг» на живых людях (спросил / ответили / дневник / пуши).
  if (companion) lines.push(companion);
  return { title: `📊 LifeOS за ${s.day.slice(8, 10)}.${s.day.slice(5, 7)}`, body: lines.join('\n') };
}

export async function buildDailyDigest(now: Date = new Date()): Promise<{ title: string; body: string; summary: DaySummary }> {
  const yesterday = addDays(dayStr(now), -1);
  const [summary, d1, d7, comp] = await Promise.all([
    daySummary(yesterday),
    retentionOn(yesterday, 1),
    retentionOn(yesterday, 7),
    companionStats(yesterday).catch(() => null),
  ]);
  return { ...digestText(summary, d1, d7, comp ? companionLine(comp) : null), summary };
}
