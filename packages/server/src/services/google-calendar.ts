/**
 * Phase 3.1 — реальная двусторонняя синхронизация с Google Calendar.
 *
 * Раньше `/integrations/google-calendar/sync` был Placeholder (возвращал
 * eventsImported:0). Теперь:
 *   • connect: мобилка делает OAuth (PKCE) → присылает auth `code` →
 *     сервер меняет его на токены (client_secret НИКОГДА не покидает
 *     сервер — secure pattern).
 *   • sync pull:  Google → CalendarEvent (дедуп по externalId).
 *   • sync push:  локальные события (source manual/voice, без externalId)
 *     → Google, и сохраняем вернувшийся googleEventId как externalId.
 *
 * Креды берутся из ENV: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
 * Без них функции бросают googleConfigError() — вызывающий код
 * отвечает 503 с понятным сообщением (не 500, не молчаливый мок).
 *
 * Часовой пояс: локальные события без TZ трактуем как Asia/Almaty
 * (дефолт KZ из CLAUDE.md) при пуше в Google.
 */

import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../lib/crypto.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const DEFAULT_TZ = 'Asia/Almaty';
const FETCH_TIMEOUT_MS = 12_000;

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'not_configured'
      | 'auth_failed'
      | 'api_error'
      | 'token_refresh_failed',
  ) {
    super(message);
    this.name = 'GoogleCalendarError';
  }
}

function creds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleCalendarError(
      'Google Calendar не настроен на сервере (нет GOOGLE_CLIENT_ID/SECRET)',
      'not_configured',
    );
  }
  return { clientId, clientSecret };
}

async function fetchTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// -----------------------------------------------------------------------------
// Серверный OAuth-redirect (Web-клиент не принимает кастомную схему
// мобилки lifeos://, а Expo-прокси в SDK54 удалён). Поэтому Google
// редиректит на НАШ сервер: /callback → сервер меняет code на токены
// своим secret и получает refresh для фоновой синхронизации.
//
// PKCE-verifier и привязка state→userId хранятся in-memory с TTL —
// консистентно с pending-actions.ts / rate-limiter (single-instance
// Railway). state одноразовый, живёт 10 минут.
// -----------------------------------------------------------------------------

/** Публичный URL сервера для redirect_uri (должен совпадать с тем, что
 *  прописан в Authorized redirect URIs Google-клиента). */
export function callbackUrl(): string {
  const base =
    process.env.PUBLIC_API_URL ||
    'https://lifeos-api-production-736d.up.railway.app';
  return `${base.replace(/\/$/, '')}/integrations/google-calendar/callback`;
}

interface OAuthPending {
  userId: string;
  verifier: string;
  createdAt: number;
}
const OAUTH_TTL_MS = 10 * 60 * 1000;
const oauthStates = new Map<string, OAuthPending>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of oauthStates.entries()) {
    if (now - v.createdAt > OAUTH_TTL_MS) oauthStates.delete(k);
  }
}, 60_000).unref?.();

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Старт OAuth: генерим PKCE+state, возвращаем URL для открытия в браузере. */
export function createAuthUrl(userId: string): string {
  const { clientId } = creds();
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(24));
  oauthStates.set(state, { userId, verifier, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope:
      'https://www.googleapis.com/auth/calendar ' +
      'https://www.googleapis.com/auth/gmail.readonly',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Забирает (и инвалидирует) привязку state→userId+verifier. */
export function consumeAuthState(
  state: string,
): { userId: string; verifier: string } | null {
  const p = oauthStates.get(state);
  if (!p) return null;
  oauthStates.delete(state);
  if (Date.now() - p.createdAt > OAUTH_TTL_MS) return null;
  return { userId: p.userId, verifier: p.verifier };
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Unix ms когда access протухнет (с запасом 60с). */
  expiresAt: number;
}

/** Обмен authorization code (PKCE) на токены. */
export async function exchangeCode(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<GoogleTokens> {
  const { clientId, clientSecret } = creds();
  const body = new URLSearchParams({
    code: params.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: params.codeVerifier,
  });

  const res = await fetchTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new GoogleCalendarError(
      `Не удалось обменять код Google (${res.status}): ${txt.slice(0, 200)}`,
      'auth_failed',
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
}

/** Обновление access по refresh_token. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const { clientId, clientSecret } = creds();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetchTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new GoogleCalendarError(
      `Не удалось обновить токен Google (${res.status}): ${txt.slice(0, 200)}`,
      'token_refresh_failed',
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
}

export interface NormalizedEvent {
  externalId: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM | null (null = весь день) */
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  description: string | null;
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/** "2026-05-16T14:30:00+05:00" → { date:"2026-05-16", time:"14:30" } */
function splitDateTime(dt: string): { date: string; time: string } {
  const d = new Date(dt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Pull: события Google в диапазоне [timeMin, timeMax] (ISO). */
export async function listEvents(
  accessToken: string,
  timeMinISO: string,
  timeMaxISO: string,
): Promise<NormalizedEvent[]> {
  const url =
    `${GOOGLE_CAL_BASE}?` +
    new URLSearchParams({
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    }).toString();

  const res = await fetchTimeout(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new GoogleCalendarError(
      `Google Calendar API ошибка списка (${res.status}): ${txt.slice(0, 200)}`,
      'api_error',
    );
  }

  const data = (await res.json()) as { items?: GoogleEvent[] };
  const out: NormalizedEvent[] = [];

  for (const e of data.items ?? []) {
    if (e.status === 'cancelled' || !e.id) continue;
    const title = e.summary?.trim() || '(без названия)';

    if (e.start?.dateTime && e.end?.dateTime) {
      const s = splitDateTime(e.start.dateTime);
      const en = splitDateTime(e.end.dateTime);
      out.push({
        externalId: e.id,
        title,
        date: s.date,
        startTime: s.time,
        endTime: en.time,
        location: e.location ?? null,
        description: e.description ?? null,
      });
    } else if (e.start?.date) {
      // Событие на весь день
      out.push({
        externalId: e.id,
        title,
        date: e.start.date,
        startTime: null,
        endTime: null,
        location: e.location ?? null,
        description: e.description ?? null,
      });
    }
  }

  return out;
}

/** Push: создать локальное событие в Google. Возвращает googleEventId. */
export async function insertEvent(
  accessToken: string,
  ev: {
    title: string;
    date: string; // YYYY-MM-DD
    startTime: string | null; // HH:MM
    endTime: string | null;
    location: string | null;
    description: string | null;
  },
): Promise<string> {
  const body: Record<string, unknown> = {
    summary: ev.title,
    ...(ev.location ? { location: ev.location } : {}),
    ...(ev.description ? { description: ev.description } : {}),
  };

  if (ev.startTime) {
    const end = ev.endTime || ev.startTime;
    body.start = { dateTime: `${ev.date}T${ev.startTime}:00`, timeZone: DEFAULT_TZ };
    body.end = { dateTime: `${ev.date}T${end}:00`, timeZone: DEFAULT_TZ };
  } else {
    // Весь день: Google требует end.date = следующий день.
    const next = new Date(`${ev.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    body.start = { date: ev.date };
    body.end = { date: next.toISOString().slice(0, 10) };
  }

  const res = await fetchTimeout(GOOGLE_CAL_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new GoogleCalendarError(
      `Google Calendar API ошибка создания (${res.status}): ${txt.slice(0, 200)}`,
      'api_error',
    );
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * Свежий Google access-token для userId (рефреш при протухании +
 * персист). Один Google-OAuth на calendar+gmail (тот же integration
 * 'google_calendar', scope расширен). Используется и Calendar-sync,
 * и Gmail-триажом.
 */
export async function getFreshGoogleAccessToken(userId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: 'google_calendar' } },
  });
  if (!integration || !integration.active) {
    throw new GoogleCalendarError('Google не подключён', 'auth_failed');
  }
  if (!integration.refreshToken) {
    throw new GoogleCalendarError(
      'Нет refresh-токена. Переподключи Google.',
      'auth_failed',
    );
  }
  const settings = (integration.settings as { expiresAt?: number }) || {};
  if (
    integration.accessToken &&
    settings.expiresAt &&
    settings.expiresAt > Date.now()
  ) {
    return decrypt(integration.accessToken);
  }
  const refreshed = await refreshAccessToken(decrypt(integration.refreshToken));
  await prisma.integration.update({
    where: { userId_provider: { userId, provider: 'google_calendar' } },
    data: {
      accessToken: encrypt(refreshed.accessToken),
      settings: { ...settings, expiresAt: refreshed.expiresAt },
    },
  });
  return refreshed.accessToken;
}
