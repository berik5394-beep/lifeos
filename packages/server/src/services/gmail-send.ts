/**
 * Руки во внешнем мире (docs/plan/jarvis-roadmap.md №4): письмо от имени
 * пользователя через его Gmail. Только из инструмента send_email, который
 * исполняется ПОСЛЕ «да» (needsConfirm) — робот сам ничего не отправляет.
 *
 * Право gmail.send выдаётся при подключении Google; у подключивших раньше его
 * нет — честно просим переподключить, а не падаем на отказе Google.
 */
import { prisma } from '../lib/prisma.js';
import { getFreshGoogleAccessToken, GMAIL_SEND_SCOPE, GoogleCalendarError } from './google-calendar.js';

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const FETCH_TIMEOUT_MS = 15_000;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

export class MailSendError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_connected' | 'need_reconnect' | 'bad_address' | 'api_error',
  ) {
    super(message);
    this.name = 'MailSendError';
  }
}

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
}

export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/** Заголовок в UTF-8 (RFC 2047) — кириллица в теме доходит целой. */
function encodeHeader(v: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

/** Письмо в формате RFC 2822 → base64url для Gmail API. Чистая. */
export function buildRawEmail(m: OutgoingMail): string {
  const subject = m.subject.replace(/[\r\n]+/g, ' ').trim();
  const to = m.to.replace(/[\r\n]+/g, '').trim();
  const body = Buffer.from(m.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const mime = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Есть ли у пользователя право отправлять письма (выдано при подключении Google). */
export async function canSendMail(userId: string): Promise<'ok' | 'not_connected' | 'need_reconnect'> {
  const integ = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: 'google_calendar' } },
    select: { active: true, refreshToken: true, settings: true },
  });
  if (!integ || !integ.active || !integ.refreshToken) return 'not_connected';
  const scopes = (integ.settings as { scopes?: unknown } | null)?.scopes;
  return Array.isArray(scopes) && scopes.includes(GMAIL_SEND_SCOPE) ? 'ok' : 'need_reconnect';
}

const RECONNECT =
  'Чтобы я отправлял письма, переподключи Google: Настройки → Интеграции → Google — и разреши отправку почты.';

/** Отправить письмо через Gmail пользователя. Возвращает id письма. */
export async function sendGmail(userId: string, m: OutgoingMail, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!isEmail(m.to)) throw new MailSendError(`«${m.to}» — не похоже на адрес почты.`, 'bad_address');
  const access = await canSendMail(userId);
  if (access === 'not_connected') throw new MailSendError('Google не подключён. ' + RECONNECT, 'not_connected');
  if (access === 'need_reconnect') throw new MailSendError(RECONNECT, 'need_reconnect');
  let token: string;
  try {
    token = await getFreshGoogleAccessToken(userId);
  } catch (err) {
    throw new MailSendError(
      err instanceof GoogleCalendarError ? `${err.message} ${RECONNECT}` : RECONNECT,
      'need_reconnect',
    );
  }
  const res = await fetchImpl(SEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: buildRawEmail(m) }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) throw new MailSendError(RECONNECT, 'need_reconnect');
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.warn(`[gmail-send] ${res.status}: ${txt.slice(0, 200)}`);
    throw new MailSendError('Gmail не принял письмо — попробуй ещё раз чуть позже.', 'api_error');
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return data.id ?? '';
}
