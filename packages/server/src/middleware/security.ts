/**
 * Минимальная безопасность без внешних зависимостей.
 *
 * Реализует:
 *   - rateLimiter: in-memory токен-бакет на IP, окно 60 секунд
 *   - securityHeaders: набор HTTP security-headers (аналог @fastify/helmet lite)
 *   - getClientIp: получение IP с учётом прокси (Railway, Cloudflare и т.д.)
 *
 * Когда сможешь поставить @fastify/rate-limit и @fastify/helmet —
 * замени реализации на официальные. Сейчас этот файл закрывает дыры
 * без необходимости что-то докачивать.
 */

import type { FastifyRequest, FastifyReply, FastifyInstance, onRequestHookHandler } from 'fastify';

// ============================================================================
// 1. Получение IP клиента (учитывает прокси)
// ============================================================================

export function getClientIp(request: FastifyRequest): string {
  // Railway / Cloudflare / nginx обычно ставят X-Forwarded-For
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    // Берём первый IP в цепочке (он же исходный клиент)
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0];
  }
  return request.ip || 'unknown';
}

// ============================================================================
// 2. In-memory rate limiter
// ============================================================================

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

// Периодическая чистка устаревших бакетов чтобы Map не рос вечно
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt < now) {
      buckets.delete(key);
    }
  }
}, 60_000).unref?.();

export type RateLimitOptions = {
  /** Максимум запросов в окне */
  max: number;
  /** Окно в миллисекундах (по умолчанию 60 секунд) */
  windowMs?: number;
  /** Префикс ключа — позволяет разделить лимиты для разных эндпоинтов */
  keyPrefix?: string;
};

/**
 * Создаёт preHandler для rate-limiting.
 *
 * Пример использования:
 *   app.post('/auth/login', {
 *     preHandler: [rateLimiter({ max: 5, windowMs: 60_000, keyPrefix: 'login' })],
 *   }, handler);
 */
export function rateLimiter(options: RateLimitOptions): onRequestHookHandler {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max;
  const prefix = options.keyPrefix ?? 'default';

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Per-user keying когда юзер аутентифицирован — так два юзера за одним
    // NAT (офисный Wi-Fi, мобильный оператор с CGNAT) не делят общий бакет.
    // Для публичных роутов (login, register, refresh, глобальный лимитер
    // onRequest) userId ещё не установлен authMiddleware → fallback на IP,
    // что корректно для анти-брутфорса и анти-DoS.
    //
    // ВАЖНО: authMiddleware ставит request.userId в preHandler, а rateLimiter
    // тоже обычно цепляется как preHandler. Порядок регистрации preHandler'ов
    // важен — если rateLimiter повешен раньше auth (например, глобально через
    // onRequest), userId ещё не установлен и мы автоматически упадём на IP.
    // Это ожидаемое поведение: глобальный лимитер защищает от DoS по IP,
    // а per-route лимитеры после auth — от спама одним юзером.
    // request.userId типизирован как string, но до authMiddleware он
    // фактически undefined — читаем через as, чтобы проверка работала
    // на глобальном лимитере (который бежит до auth).
    const maybeUserId = (request as FastifyRequest & { userId?: string }).userId;
    // Префиксуем user: или ip: чтобы userId="1.2.3.4" случайно не совпал с IP
    const key = maybeUserId
      ? `${prefix}:user:${maybeUserId}`
      : `${prefix}:ip:${getClientIp(request)}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    // Заголовки для клиента — сколько осталось попыток
    reply.header('X-RateLimit-Limit', String(max));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    reply.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      reply.header('Retry-After', String(retryAfterSec));
      return reply.status(429).send({
        message: `Слишком много запросов. Попробуй через ${retryAfterSec} сек.`,
      });
    }
  };
}

// ============================================================================
// 3. Security headers (минимальный helmet)
// ============================================================================

/**
 * Регистрирует hook, добавляющий стандартные security-headers.
 * Аналог @fastify/helmet с разумным дефолтом для JSON API.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    // Запрещаем встраивать сайт в iframe (защита от clickjacking)
    reply.header('X-Frame-Options', 'DENY');
    // Запрещаем браузеру угадывать MIME-тип (защита от MIME-confusion атак)
    reply.header('X-Content-Type-Options', 'nosniff');
    // Контроль рефереров — не утекаем URL в third-party
    reply.header('Referrer-Policy', 'no-referrer');
    // Запрещаем браузерным фичам пользоваться контентом сайта
    reply.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    // Strict Transport Security — заставляем браузеры всегда использовать HTTPS
    // (актуально только если сервер за TLS — Railway даёт TLS автоматически)
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Минимальный CSP для JSON API: ничего загружать не нужно
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    // Защита от XSS в старых браузерах
    reply.header('X-XSS-Protection', '0');
    return payload;
  });
}

// ============================================================================
// 4. Валидация пароля по разумным правилам
// ============================================================================

export type PasswordValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'qwerty123',
  'qwertyui', 'password1', 'iloveyou', 'admin123', 'welcome1',
  '11111111', '00000000', 'abc12345', 'letmein1', 'monkey12',
  'football', 'dragon12', 'baseball', 'sunshine', 'princess',
]);

export function validatePassword(password: string): PasswordValidationResult {
  if (password.length < 8) {
    return { valid: false, reason: 'Пароль должен быть минимум 8 символов' };
  }
  if (password.length > 128) {
    return { valid: false, reason: 'Пароль слишком длинный (максимум 128)' };
  }
  if (!/[a-zA-Zа-яА-Я]/.test(password)) {
    return { valid: false, reason: 'Пароль должен содержать хотя бы одну букву' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, reason: 'Пароль должен содержать хотя бы одну цифру' };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, reason: 'Этот пароль слишком распространён, придумай надёжнее' };
  }
  return { valid: true };
}
