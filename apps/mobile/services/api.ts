import { getDeviceTimezone } from './device-tz';

// NOTE: EXPO_PUBLIC_API_URL should be set via `app.config.ts` `extra`
// or a .env file (apps/mobile/.env) for physical devices on LAN/LTE.
// Localhost fallback only works for simulators/web dev.
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

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
  /** Ключ повтора записи (Idempotency-Key): сервер не запишет её дважды. */
  idempotencyKey?: string;
  /** Сколько ждать ответа. Мозгу (чат, подтверждение) нужно больше 15 с. */
  timeoutMs?: number;
  /** Временный id записи, созданной без сети: после отправки очереди его
   *  заменят настоящим в следующих запросах (отметка/удаление той же записи). */
  localId?: string;
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

export const OFFLINE_ERROR = 'Нет интернета — попробуй, когда появится связь.';
/**
 * Не дождались ответа (сервер жив, но думает долго). Это НЕ «нет интернета»:
 * сервер мог доделать дело — повтор сразу дал бы дубль задачи.
 */
export const SLOW_SERVER_ERROR = 'Думаю дольше обычного. Не повторяй сразу — через минуту проверь, выполнилось ли.';
/** Ожидание ответа мозга: поиск в интернете + инструменты бывают 20–40 с. */
export const BRAIN_TIMEOUT_MS = 60_000;

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

/** Случайный ключ записи (Idempotency-Key). Формат сервера: [A-Za-z0-9_-]{8,80}. */
export function newIdempotencyKey(): string {
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `m-${Date.now().toString(36)}-${rnd()}${rnd()}`;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, queueOffline = false } = options;
  // Запись, которая может уйти в офлайн-очередь, получает ключ сразу: если
  // сервер записал, а ответ потерялся, повтор из очереди с тем же ключом
  // вернёт сохранённый ответ, а не создаст вторую трату/задачу.
  const idempotencyKey = options.idempotencyKey ?? (method === 'POST' && queueOffline ? newIdempotencyKey() : undefined);
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
      userId: getAuthStore().getState().user?.id,
      idempotencyKey,
      localId: options.localId,
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

  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

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
    response = await fetchWithTimeout(url, fetchOptions, options.timeoutMs);
  } catch (networkError) {
    const timedOut = networkError instanceof Error && networkError.name === 'AbortError';
    // Network error или таймаут (AbortError). В обоих случаях
    // офлайн-fallback/очередь работают одинаково — пользователь не видит разницы.
    if (method === 'GET') {
      // Fall back to cache
      const cached = await om.getCachedData<T>(endpoint);
      if (cached !== null) return cached;
    } else if (!queueOffline) {
      // Таймаут ≠ нет сети: сервер мог выполнить команду — честно говорим «долго».
      if (timedOut) throw new ApiError(408, SLOW_SERVER_ERROR);
      throw new ApiError(0, OFFLINE_ERROR);
    } else {
      // Таймаут/обрыв: сервер мог УЖЕ записать — повтор уйдёт с тем же ключом.
      await om.offlineQueue.enqueue({
        method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        endpoint,
        body,
        userId: getAuthStore().getState().user?.id,
        idempotencyKey,
        localId: options.localId,
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
  get: <T>(endpoint: string, token?: MaybeToken, opts?: { timeoutMs?: number }) =>
    request<T>(endpoint, { token: token ?? undefined, ...opts }),

  post: <T>(endpoint: string, body: unknown, token?: MaybeToken, opts?: { queueOffline?: boolean; timeoutMs?: number; localId?: string }) =>
    request<T>(endpoint, { method: 'POST', body, token: token ?? undefined, ...opts }),

  put: <T>(endpoint: string, body: unknown, token?: MaybeToken, opts?: { queueOffline?: boolean; timeoutMs?: number }) =>
    request<T>(endpoint, { method: 'PUT', body, token: token ?? undefined, ...opts }),

  patch: <T>(endpoint: string, body: unknown, token?: MaybeToken, opts?: { queueOffline?: boolean; timeoutMs?: number }) =>
    request<T>(endpoint, { method: 'PATCH', body, token: token ?? undefined, ...opts }),

  delete: <T>(endpoint: string, token?: MaybeToken, opts?: { queueOffline?: boolean }) =>
    request<T>(endpoint, { method: 'DELETE', token: token ?? undefined, ...opts }),

  /**
   * Повтор записи из офлайн-очереди (без повторной постановки в очередь).
   * true — ушло; false — сервер окончательно отказал (4xx: задачи уже нет и т.п.) →
   * выкинуть; throw — нет сети/сервера/доступа (401, 408, 429, 5xx) → оставить в очереди.
   */
  replayQueued: async (
    m: { method: string; endpoint: string; body?: unknown; idempotencyKey?: string },
    token: MaybeToken,
  ): Promise<boolean | { ok: true; createdId?: string }> => {
    try {
      const res = await request<unknown>(m.endpoint, { method: m.method, body: m.body, token: token ?? undefined, idempotencyKey: m.idempotencyKey });
      // Создание: настоящий id — очередь подставит его вместо временного.
      const createdId = m.method === 'POST' && res && typeof res === 'object' && typeof (res as { id?: unknown }).id === 'string'
        ? (res as { id: string }).id
        : undefined;
      return createdId ? { ok: true, createdId } : true;
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
  postRaw: async (endpoint: string, body?: unknown, token?: MaybeToken): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    // Раньше без токена → сервер всегда 401, экспорт CSV не работал никогда.
    const auth = token ?? getAuthStore().getState().token;
    if (auth) headers['Authorization'] = `Bearer ${auth}`;
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
