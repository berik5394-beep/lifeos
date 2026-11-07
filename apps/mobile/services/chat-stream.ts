import { fetch as expoFetch } from 'expo/fetch';
import { API_URL, ApiError, BRAIN_TIMEOUT_MS, OFFLINE_ERROR, SLOW_SERVER_ERROR } from '@/services/api';
import { getDeviceTimezone } from '@/services/device-tz';

/**
 * Потоковый ответ мозга (jarvis-roadmap №5): POST /voice/chat/stream, NDJSON.
 * {"t":"d","x":кусок}… → onDelta; {"t":"done",…} — итог (как /voice/chat);
 * {"t":"error"} — ошибка. expo/fetch читает тело по кускам (обычный fetch в
 * React Native так не умеет); модуль уже в сборке — нужен только JS.
 */
export interface StreamDone {
  message: string;
  intent?: string;
  pendingAction?: { action: string; input: Record<string, unknown> } | null;
  emotion?: string;
  openPanel?: string | null;
  /** Что сервер отдал кусками — для сверки с итогом. */
  streamed: string;
}

/** Сервер ещё без потока (404) или вход протух (401) — сообщение НЕ обработано, можно обычным путём. */
export class StreamUnavailableError extends Error {
  constructor(public status: number) {
    super(`stream unavailable: ${status}`);
  }
}

/** Разбор строк NDJSON из кусков сети (строка может прийти частями). Чистая. */
export function createNdjsonParser(onLine: (obj: Record<string, unknown>) => void): (chunk: string) => void {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    let i = buf.indexOf('\n');
    while (i >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) {
        try {
          onLine(JSON.parse(line) as Record<string, unknown>);
        } catch {
          /* битая строка — пропускаем */
        }
      }
      i = buf.indexOf('\n');
    }
  };
}

export async function streamChat(
  text: string,
  token: string,
  onDelta: (x: string) => void,
  opts: { voice?: boolean; webSearch?: boolean } = {},
): Promise<StreamDone> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRAIN_TIMEOUT_MS);
  let res;
  try {
    res = await expoFetch(`${API_URL}/voice/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Timezone': getDeviceTimezone(),
      },
      body: JSON.stringify({ text, webSearch: opts.webSearch ?? true, ...(opts.voice ? { voice: true } : {}) }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new ApiError(aborted ? 408 : 0, aborted ? SLOW_SERVER_ERROR : OFFLINE_ERROR);
  }
  if (res.status === 404 || res.status === 401) {
    clearTimeout(timer);
    throw new StreamUnavailableError(res.status);
  }
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    let message = 'Произошла ошибка. Попробуйте ещё раз.';
    try {
      const j = (await res.json()) as { message?: string };
      if (j?.message) message = j.message;
    } catch {
      /* тело не JSON */
    }
    throw new ApiError(res.status, message);
  }

  let done: StreamDone | null = null;
  let failure: string | null = null;
  const feed = createNdjsonParser((o) => {
    if (o.t === 'd' && typeof o.x === 'string') onDelta(o.x);
    else if (o.t === 'done') done = o as unknown as StreamDone;
    else if (o.t === 'error') failure = typeof o.message === 'string' ? o.message : 'Ошибка обработки чата';
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      if (value) feed(decoder.decode(value, { stream: true }));
    }
    feed(decoder.decode());
  } catch {
    // Связь оборвалась посреди ответа: сервер мог уже выполнить — не повторять (408).
    throw new ApiError(408, SLOW_SERVER_ERROR);
  } finally {
    clearTimeout(timer);
  }
  if (failure) throw new ApiError(500, 'Произошла ошибка. Попробуйте ещё раз.');
  if (!done) throw new ApiError(408, SLOW_SERVER_ERROR);
  return done;
}
