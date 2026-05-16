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
