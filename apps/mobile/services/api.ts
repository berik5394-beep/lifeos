import { getDeviceTimezone } from './device-tz';

// NOTE: EXPO_PUBLIC_API_URL should be set via `app.config.ts` `extra`
// or a .env file (apps/mobile/.env) for physical devices on LAN/LTE.
// Localhost fallback only works for simulators/web dev.
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

// ────────────────────────────────────────────────────────────────────────
// Fetch с таймаутом: RN `fetch` не даёт отменить зависший запрос по умолчанию.
// Без таймаута UI может висеть вечно на мёртвом LTE или упавшем сервере.
// 15с для обычных запросов, long-poll-роуты могут переопределить через opts.
// ────────────────────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Lazy imports to break circular dependencies
let _useAuthStore: typeof import('@/stores/auth-store').useAuthStore | null = null;
function getAuthStore() {
  if (!_useAuthStore) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _useAuthStore = require('@/stores/auth-store').useAuthStore;
  }
  return _useAuthStore!;
}

let _offlineManager: typeof import('@/services/offline-manager') | null = null;
function getOfflineManager() {
  if (!_offlineManager) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _offlineManager = require('@/services/offline-manager');
  }
  return _offlineManager!;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
  /** true — без сети поставить запись в офлайн-очередь (уйдёт при появлении
   *  связи) и бросить OfflineQueuedError, чтобы стор показал запись локально.
   *  По умолчанию false: ИИ-запросы, вход, чат, покупки «потом» без ведома
   *  юзера повторять нельзя — честная ошибка «нет интернета». */
  queueOffline?: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Запись поставлена в офлайн-очередь и уйдёт на сервер, когда появится связь.
 * Раньше в этом случае возвращался `{}` — сторы клали его в списки как задачу/
 * трату (пустые строки, падения), а очередь никто не отправлял.
 */
export class OfflineQueuedError extends ApiError {
  readonly queued = true;
  constructor() {
    super(0, 'Нет сети — сохранил на телефоне, отправлю, когда появится связь.');
    this.name = 'OfflineQueuedError';
  }
}

export function isOfflineQueued(err: unknown): err is OfflineQueuedError {
  return err instanceof OfflineQueuedError;
}

/** Для сторов: обычная CRUD-запись, которую можно отправить позже. */
export const QUEUE_OFFLINE = { queueOffline: true } as const;

const OFFLINE_ERROR = 'Нет интернета — попробуй, когда появится связь.';

// Lock to prevent multiple simultaneous refresh attempts
let refreshPromise: Promise<string | null> | null = null;

async function refreshToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      await getAuthStore().getState().refreshAuth();
      return getAuthStore().getState().token;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function getErrorMessage(response: Response): Promise<string> {
  // Сервер иногда отвечает HTML (502 от прокси, падение Railway) — json() на такой
  // ответ кидает SyntaxError внутри fetch-обёртки и клиент видит непонятное.
  // Читаем text(), пытаемся распарсить как JSON, иначе возвращаем дефолтное сообщение.
  try {
    const text = await response.text();
    if (!text) return 'Ошибка сервера';
    try {
      const parsed = JSON.parse(text);
      return parsed?.message || parsed?.error || 'Ошибка сервера';
    } catch {
      return 'Ошибка сервера';
    }
  } catch {
    return 'Ошибка сервера';
  }
}

function parseJsonSafe<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const contentLength = response.headers.get('content-length');
  if (response.status === 204 || contentLength === '0' || !contentType.includes('application/json')) {
    return response.json().catch(() => ({} as T)) as Promise<T>;
  }
  return response.json() as Promise<T>;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, queueOffline = false } = options;
  const om = getOfflineManager();

  // ── Offline handling ──────────────────────────────────────────────────
  if (!om.networkMonitor.isConnected) {
    // For GET requests — return cached data
    if (method === 'GET') {
      const cached = await om.getCachedData<T>(endpoint);
      if (cached !== null) return cached;
      throw new ApiError(0, 'Нет интернета. Данные недоступны.');
    }
    if (!queueOffline) throw new ApiError(0, OFFLINE_ERROR);

    // CRUD-запись — в очередь; стор сам покажет её локально.
    await om.offlineQueue.enqueue({
      method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      endpoint,
      body,
    });
    throw new OfflineQueuedError();
  }

  // ── Online request ────────────────────────────────────────────────────
  const headers: Record<string, string> = {};

  // Only set Content-Type for requests that have a body
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Real-Time Foundation: настоящий пояс устройства на КАЖДЫЙ запрос
  // (getDeviceTimezone синхронный, всегда свежий → перелёт подхватывается).
  headers['X-Timezone'] = getDeviceTimezone();

  const fetchOptions: RequestInit = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  const url = `${API_URL}${endpoint}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, fetchOptions);
  } catch (networkError) {
    // Network error или таймаут (AbortError). В обоих случаях
    // офлайн-fallback/очередь работают одинаково — пользователь не видит разницы.
    if (method === 'GET') {
      // Fall back to cache
      const cached = await om.getCachedData<T>(endpoint);
      if (cached !== null) return cached;
    } else if (!queueOffline) {
      throw new ApiError(0, OFFLINE_ERROR);
    } else {
      await om.offlineQueue.enqueue({
        method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        endpoint,
        body,
      });
      throw new OfflineQueuedError();
    }
    throw new ApiError(0, 'Ошибка сети. Проверьте подключение к интернету.');
  }

  if (!response.ok) {
    // On 401 with a token, attempt to refresh and retry once
    if (response.status === 401 && token) {
      const newToken = await refreshToken();
      if (newToken) {
        const retryResponse = await fetchWithTimeout(url, {
          ...fetchOptions,
          headers: { ...headers, Authorization: `Bearer ${newToken}` },
        });
        if (!retryResponse.ok) {
          throw new ApiError(retryResponse.status, await getErrorMessage(retryResponse));
        }
        const data = await parseJsonSafe<T>(retryResponse);
        // Cache successful GET responses
        if (method === 'GET') {
          om.cacheData(endpoint, data).catch(() => {});
        }
        return data;
      }
    }

    throw new ApiError(response.status, await getErrorMessage(response));
  }

  const data = await parseJsonSafe<T>(response);

  // Cache successful GET responses for offline access
  if (method === 'GET') {
    om.cacheData(endpoint, data).catch(() => {});
  }

  return data;
}

// auth-store keeps token as `string | null` — accept both forms so callers
// don't need to `?? undefined` at every call site.
type MaybeToken = string | null | undefined;

export const api = {
  get: <T>(endpoint: string, token?: MaybeToken) =>
    request<T>(endpoint, { token: token ?? undefined }),

  post: <T>(endpoint: string, body: unknown, token?: MaybeToken, opts?: { queueOffline?: boolean }) =>
    request<T>(endpoint, { method: 'POST', body, token: token ?? undefined, ...opts }),

  put: <T>(endpoint: string, body: unknown, token?: MaybeToken, opts?: { queueOffline?: boolean }) =>
    request<T>(endpoint, { method: 'PUT', body, token: token ?? undefined, ...opts }),

  patch: <T>(endpoint: string, body: unknown, token?: MaybeToken, opts?: { queueOffline?: boolean }) =>
    request<T>(endpoint, { method: 'PATCH', body, token: token ?? undefined, ...opts }),

  delete: <T>(endpoint: string, token?: MaybeToken, opts?: { queueOffline?: boolean }) =>
    request<T>(endpoint, { method: 'DELETE', token: token ?? undefined, ...opts }),

  /**
   * Повтор записи из офлайн-очереди (без повторной постановки в очередь).
   * true — ушло; false — сервер окончательно отказал (4xx: задачи уже нет и т.п.) →
   * выкинуть; throw — нет сети/сервера/доступа (401, 408, 429, 5xx) → оставить в очереди.
   */
  replayQueued: async (m: { method: string; endpoint: string; body?: unknown }, token: MaybeToken): Promise<boolean> => {
    try {
      await request<unknown>(m.endpoint, { method: m.method, body: m.body, token: token ?? undefined });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && ![401, 408, 429].includes(err.status)) return false;
      throw err;
    }
  },

  /**
   * Multipart upload (FormData). Тот же 401-retry как у обычного request,
   * но Content-Type выставляет сам RN/браузер (с правильным boundary).
   * Таймаут увеличен — загрузка файла может занять до 45с на медленной сети.
   */
  upload: async <T>(endpoint: string, formData: FormData, token?: MaybeToken): Promise<T> => {
    const tk = token ?? undefined;
    const url = `${API_URL}${endpoint}`;
    const buildHeaders = (t?: string): Record<string, string> => {
      const h: Record<string, string> = {};
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    };

    let response = await fetchWithTimeout(
      url,
      { method: 'POST', headers: buildHeaders(tk), body: formData },
      45_000,
    );

    if (response.status === 401 && tk) {
      const newToken = await refreshToken();
      if (newToken) {
        response = await fetchWithTimeout(
          url,
          { method: 'POST', headers: buildHeaders(newToken), body: formData },
          45_000,
        );
      }
    }

    if (!response.ok) {
      throw new ApiError(response.status, await getErrorMessage(response));
    }
    return parseJsonSafe<T>(response);
  },

  /** Returns raw Response (for CSV downloads, etc.) */
  postRaw: async (endpoint: string, body?: unknown): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const url = `${API_URL}${endpoint}`;
    // Долгие загрузки (PDF-отчёт, Stories-картинка) могут идти до 45с — поэтому увеличенный таймаут.
    return fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      45_000,
    );
  },
};
