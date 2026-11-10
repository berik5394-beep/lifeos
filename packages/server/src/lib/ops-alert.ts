/**
 * Оповещения о сбоях моделей (Berik 2026-11-09). Голос дважды ломался молча:
 * истёк ключ Groq, кончился баланс Anthropic — узнали от Berik, а не от
 * системы. Теперь каждый неуспешный ответ провайдера классифицируется, и
 * владельцу (OPS_ALERT_USER_IDS, через запятую) уходит пуш — не чаще раза в
 * час на один вид сбоя. Временные сбои (перегруз, лимит) — только если их
 * много подряд: единичный 529 SDK переживает ретраем.
 */

export type ProviderName = 'claude' | 'groq';
export type FailureKind = 'auth' | 'billing' | 'rate' | 'overloaded' | 'other';

export function classifyFailure(status: number, body: string): FailureKind {
  const b = body.toLowerCase();
  if (status === 401 || status === 403) return 'auth';
  if (status === 402 || /credit balance|billing|insufficient.*(credit|fund|balance)/.test(b)) return 'billing';
  if (status === 429) return 'rate';
  if (status === 529 || status >= 500) return 'overloaded';
  return 'other';
}

const PROVIDER_LABEL: Record<ProviderName, string> = { claude: 'Claude (мозг робота)', groq: 'Groq (распознавание голоса)' };
const KEY_VAR: Record<ProviderName, string> = { claude: 'CLAUDE_API_KEY', groq: 'GROQ_API_KEY' };

export function alertText(provider: ProviderName, kind: FailureKind, count: number): { title: string; body: string } | null {
  const who = PROVIDER_LABEL[provider];
  switch (kind) {
    case 'auth':
      return {
        title: `⚠️ ${who}: ключ не принят`,
        body: `Сервис отвечает «нет доступа» — робот не работает у всех. Замени ${KEY_VAR[provider]} в Railway.`,
      };
    case 'billing':
      return {
        title: `⚠️ ${who}: кончился баланс`,
        body: provider === 'claude'
          ? 'Anthropic отказывает из-за баланса — робот молчит у всех. Пополни на console.anthropic.com.'
          : 'Groq отказывает из-за оплаты — голос не распознаётся. Проверь console.groq.com.',
      };
    case 'rate':
      return { title: `⚠️ ${who}: упёрлись в лимит`, body: `${count} отказов «слишком много запросов» за 10 минут — ответы тормозят или пропадают.` };
    case 'overloaded':
      return { title: `⚠️ ${who}: сервис падает`, body: `${count} ошибок сервера за 10 минут — у людей сбои ответа.` };
    default:
      return null; // 400 из-за нашего запроса — это баг кода, он в логах, будить не надо
  }
}

/** Временные сбои будят только пачкой. */
const BURST_THRESHOLD = 5;
const BURST_WINDOW_MS = 10 * 60_000;
const COOLDOWN_MS = 60 * 60_000;

const recent = new Map<string, number[]>();
const lastSent = new Map<string, number>();

export function resetOpsAlertState(): void {
  recent.clear();
  lastSent.clear();
}

/** Решение без побочных эффектов: будить ли сейчас (и сколько сбоев в окне). */
export function shouldAlert(provider: ProviderName, kind: FailureKind, now: number): { send: boolean; count: number } {
  if (kind === 'other') return { send: false, count: 0 };
  const key = `${provider}:${kind}`;
  const times = (recent.get(key) ?? []).filter((t) => now - t < BURST_WINDOW_MS);
  times.push(now);
  recent.set(key, times);
  const instant = kind === 'auth' || kind === 'billing';
  if (!instant && times.length < BURST_THRESHOLD) return { send: false, count: times.length };
  const last = lastSent.get(key);
  if (last !== undefined && now - last < COOLDOWN_MS) return { send: false, count: times.length };
  lastSent.set(key, now);
  return { send: true, count: times.length };
}

const envList = (name: string): string[] =>
  (process.env[name] ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Настроены ли получатели вообще (без похода в БД). */
export function hasOpsRecipients(): boolean {
  return envList('OPS_ALERT_USER_IDS').length > 0 || envList('OPS_ALERT_EMAILS').length > 0;
}

/** Кому слать: OPS_ALERT_USER_IDS и/или OPS_ALERT_EMAILS (почта аккаунта — проще, чем id). */
export async function opsAlertRecipients(): Promise<string[]> {
  const ids = envList('OPS_ALERT_USER_IDS');
  const emails = envList('OPS_ALERT_EMAILS').map((e) => e.toLowerCase());
  if (emails.length > 0) {
    const { prisma } = await import('./prisma.js');
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    ids.push(...users.map((u) => u.id));
  }
  return [...new Set(ids)];
}

/** Сообщить о неуспешном ответе провайдера. Никогда не бросает. */
export function reportProviderFailure(provider: ProviderName, status: number, body: string, now: number = Date.now()): void {
  try {
    const kind = classifyFailure(status, body);
    const { send, count } = shouldAlert(provider, kind, now);
    if (kind !== 'other') console.warn(`[ops-alert] ${provider} ${status} kind=${kind} window=${count}`);
    if (!send) return;
    const text = alertText(provider, kind, count);
    if (!text) return;
    console.error(`[ops-alert] SEND ${provider}:${kind} — ${text.title}`);
    if (!hasOpsRecipients()) return;
    // Ленивый импорт: lib/anthropic не тянет push/prisma в юнит-тесты.
    void Promise.all([opsAlertRecipients(), import('../services/push-service.js')])
      .then(([ids, { deliverNotification }]) =>
        Promise.all(ids.map((id) => deliverNotification(id, text.title, text.body, { type: 'ops_alert' }))),
      )
      .catch((err) => console.warn('[ops-alert] deliver failed:', err instanceof Error ? err.message : err));
  } catch (err) {
    console.warn('[ops-alert] report failed:', err instanceof Error ? err.message : err);
  }
}

/** Разослать текст получателям ops-алертов (пуш на телефон). Никогда не бросает. */
function notifyOps(title: string, body: string): void {
  if (!hasOpsRecipients()) return;
  void Promise.all([opsAlertRecipients(), import('../services/push-service.js')])
    .then(([ids, { deliverNotification }]) =>
      Promise.all(ids.map((id) => deliverNotification(id, title, body, { type: 'ops_alert' }))),
    )
    .catch((err) => console.warn('[ops-alert] deliver failed:', err instanceof Error ? err.message : err));
}

/**
 * Сбой приложения у пользователя (2026-11-10: раньше падения писались только в
 * консоль телефона — мы о них не знали). Новый вид сбоя — сразу пуш; тот же
 * повторяется — не чаще раза в час (с числом повторов).
 */
export function shouldAlertCrash(signature: string, now: number): { send: boolean; count: number } {
  const key = `crash:${signature}`;
  const times = (recent.get(key) ?? []).filter((t) => now - t < COOLDOWN_MS);
  times.push(now);
  recent.set(key, times);
  const last = lastSent.get(key);
  if (last !== undefined && now - last < COOLDOWN_MS) return { send: false, count: times.length };
  lastSent.set(key, now);
  return { send: true, count: times.length };
}

export function reportClientCrash(message: string, where: string, now: number = Date.now()): void {
  try {
    const signature = `${where}|${message.slice(0, 120)}`;
    const { send, count } = shouldAlertCrash(signature, now);
    if (!send) return;
    const body = `${where ? `${where}: ` : ''}${message.slice(0, 160)}${count > 1 ? ` (×${count} за час)` : ''}`;
    console.error(`[ops-alert] SEND client-crash — ${body}`);
    notifyOps('Сбой в приложении у пользователя', body);
  } catch (err) {
    console.warn('[ops-alert] crash report failed:', err instanceof Error ? err.message : err);
  }
}
