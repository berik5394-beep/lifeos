import { prisma } from '../lib/prisma.js';
import { getFreshGoogleAccessToken, GoogleCalendarError } from './google-calendar.js';

/**
 * Phase 3.2 — Gmail-триаж (read-only).
 *
 * Где живёт 80% рутины — в почте. JARVIS читает непрочитанные,
 * классифицирует детерминированно (бесплатно, предсказуемо) и отдаёт
 * сводку «N важных, M можно проигнорировать». Отправки/черновиков
 * пока нет — только чтение (scope gmail.readonly).
 *
 * Тот же Google-OAuth, что и Calendar (integration 'google_calendar',
 * scope расширен gmail.readonly) — отдельного коннекта не нужно.
 */

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const FETCH_TIMEOUT_MS = 12_000;

async function gfetch(url: string, token: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

export type MailClass = 'important' | 'ignorable' | 'neutral';

export interface TriagedMail {
  from: string;
  subject: string;
  snippet: string;
  cls: MailClass;
}

export interface TriageResult {
  total: number;
  important: TriagedMail[];
  ignorableCount: number;
  neutralCount: number;
  summary: string;
}

const IMPORTANT_RX =
  /(счёт|счет|оплат|срочн|важн|дедлайн|deadline|договор|налог|кгд|invoice|payment|urgent|action required|просроч|задолжен|штраф|подтверд)/i;
const IGNORABLE_RX =
  /(no-?reply|noreply|newsletter|рассылк|распродаж|скидк|promo|unsubscribe|отписат|marketing|digest|уведомлени|notification)/i;

function header(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function classify(
  from: string,
  subject: string,
  snippet: string,
  contactEmails: Set<string>,
): MailClass {
  const haystack = `${subject} ${snippet}`;
  const emailMatch = from.match(/<([^>]+)>/);
  const addr = (emailMatch ? emailMatch[1] : from).toLowerCase().trim();

  // От известного контакта — почти всегда важно (живой человек).
  if (contactEmails.has(addr)) return 'important';
  if (IMPORTANT_RX.test(haystack)) return 'important';
  if (IGNORABLE_RX.test(`${from} ${haystack}`)) return 'ignorable';
  return 'neutral';
}

/** Триаж непрочитанных входящих. max ≤ 30 (защита от тяжёлых аккаунтов). */
export async function triageInbox(
  userId: string,
  max = 20,
): Promise<TriageResult> {
  const token = await getFreshGoogleAccessToken(userId);

  const listRes = await gfetch(
    `${GMAIL_BASE}/messages?q=${encodeURIComponent('is:unread in:inbox')}&maxResults=${Math.min(max, 30)}`,
    token,
  );
  if (!listRes.ok) {
    const txt = await listRes.text().catch(() => '');
    throw new GoogleCalendarError(
      `Gmail API ошибка списка (${listRes.status}): ${txt.slice(0, 200)}`,
      'api_error',
    );
  }
  const list = (await listRes.json()) as { messages?: Array<{ id: string }> };
  const ids = (list.messages ?? []).map((m) => m.id);

  if (ids.length === 0) {
    return {
      total: 0,
      important: [],
      ignorableCount: 0,
      neutralCount: 0,
      summary: 'Непрочитанных писем нет — входящие чисты.',
    };
  }

  const contacts = await prisma.contactCache.findMany({
    where: { userId, email: { not: null } },
    select: { email: true },
  });
  const contactEmails = new Set(
    contacts.map((c) => (c.email ?? '').toLowerCase().trim()).filter(Boolean),
  );

  const mails: TriagedMail[] = [];
  for (const id of ids) {
    const r = await gfetch(
      `${GMAIL_BASE}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      token,
    );
    if (!r.ok) continue;
    const msg = (await r.json()) as {
      snippet?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    };
    const headers = msg.payload?.headers ?? [];
    const from = header(headers, 'From');
    const subject = header(headers, 'Subject') || '(без темы)';
    const snippet = (msg.snippet ?? '').slice(0, 200);
    mails.push({ from, subject, snippet, cls: classify(from, subject, snippet, contactEmails) });
  }

  const important = mails.filter((m) => m.cls === 'important');
  const ignorableCount = mails.filter((m) => m.cls === 'ignorable').length;
  const neutralCount = mails.filter((m) => m.cls === 'neutral').length;

  const parts: string[] = [`Непрочитанных: ${mails.length}.`];
  if (important.length > 0) {
    parts.push(
      `Важных ${important.length}: ` +
        important
          .slice(0, 5)
          .map((m) => `«${m.subject}»`)
          .join(', ') +
        '.',
    );
  } else {
    parts.push('Срочного на первый взгляд нет.');
  }
  if (ignorableCount > 0) parts.push(`${ignorableCount} можно проигнорировать (рассылки/уведомления).`);
  if (neutralCount > 0) parts.push(`${neutralCount} прочих.`);

  return {
    total: mails.length,
    important,
    ignorableCount,
    neutralCount,
    summary: parts.join(' '),
  };
}
