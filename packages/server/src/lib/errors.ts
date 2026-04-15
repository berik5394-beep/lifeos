/**
 * Centralized error handling module for LifeOS.
 *
 * Provides typed error classes, an error code taxonomy, user-facing Russian
 * messages, and a sanitizer that strips sensitive data before logging or
 * sending errors to the client.
 */

// ---------------------------------------------------------------------------
// Error codes — stable identifiers the mobile client can switch on
// ---------------------------------------------------------------------------

export const ErrorCode = {
  // Auth (401 / 403)
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_EXPIRED_TOKEN: 'AUTH_EXPIRED_TOKEN',
  AUTH_WRONG_CREDENTIALS: 'AUTH_WRONG_CREDENTIALS',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',

  // Validation (400)
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

  // Resource (404 / 409)
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // Rate limit (429)
  RATE_LIMITED: 'RATE_LIMITED',

  // External services (502 / 503 / 504)
  EXTERNAL_API_FAILED: 'EXTERNAL_API_FAILED',
  EXTERNAL_API_TIMEOUT: 'EXTERNAL_API_TIMEOUT',
  EXTERNAL_API_UNAVAILABLE: 'EXTERNAL_API_UNAVAILABLE',
  AI_MODEL_FAILED: 'AI_MODEL_FAILED',

  // Database (500)
  DATABASE_ERROR: 'DATABASE_ERROR',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',

  // Internal (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
} as const;

export type ErrorCodeKey = keyof typeof ErrorCode;

// ---------------------------------------------------------------------------
// Base AppError class
// ---------------------------------------------------------------------------

export class AppError extends Error {
  public readonly code: ErrorCodeKey;
  public readonly statusCode: number;
  public readonly userMessage: string;
  public readonly details?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(params: {
    code: ErrorCodeKey;
    statusCode: number;
    userMessage: string;
    internalMessage?: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(params.internalMessage ?? params.userMessage);
    this.name = this.constructor.name;
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.userMessage = params.userMessage;
    this.details = params.details;
    this.isOperational = true;

    if (params.cause instanceof Error) {
      this.cause = params.cause;
    }

    Error.captureStackTrace?.(this, this.constructor);
  }
}

// ---------------------------------------------------------------------------
// Specialized error classes — thin sugar over AppError
// ---------------------------------------------------------------------------

export class ValidationError extends AppError {
  constructor(userMessage: string, details?: Record<string, unknown>) {
    super({
      code: 'VALIDATION_FAILED',
      statusCode: 400,
      userMessage,
      details,
    });
  }
}

export class AuthError extends AppError {
  constructor(code: ErrorCodeKey = 'AUTH_REQUIRED', userMessage = 'Требуется авторизация') {
    super({
      code,
      statusCode: code === 'AUTH_FORBIDDEN' ? 403 : 401,
      userMessage,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super({
      code: 'NOT_FOUND',
      statusCode: 404,
      userMessage: `${resource} не найден`,
    });
  }
}

export class ConflictError extends AppError {
  constructor(userMessage: string, details?: Record<string, unknown>) {
    super({
      code: 'CONFLICT',
      statusCode: 409,
      userMessage,
      details,
    });
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSec: number) {
    super({
      code: 'RATE_LIMITED',
      statusCode: 429,
      userMessage: 'Слишком много запросов. Попробуй через минуту.',
      details: { retryAfterSec },
    });
  }
}

export class ExternalApiError extends AppError {
  constructor(service: string, cause?: unknown, isTimeout = false) {
    super({
      code: isTimeout ? 'EXTERNAL_API_TIMEOUT' : 'EXTERNAL_API_FAILED',
      statusCode: isTimeout ? 504 : 502,
      userMessage: `Внешний сервис ${service} временно недоступен`,
      internalMessage: `External API failure: ${service}`,
      cause,
    });
  }
}

export class AiModelError extends AppError {
  constructor(cause?: unknown) {
    super({
      code: 'AI_MODEL_FAILED',
      statusCode: 503,
      userMessage: 'AI временно недоступен. Попробуй ещё раз через минуту.',
      internalMessage: 'AI model request failed',
      cause,
    });
  }
}

export class DatabaseError extends AppError {
  constructor(operation: string, cause?: unknown) {
    super({
      code: 'DATABASE_ERROR',
      statusCode: 500,
      userMessage: 'Ошибка сохранения данных. Попробуй ещё раз.',
      internalMessage: `Database operation failed: ${operation}`,
      cause,
    });
  }
}

// ---------------------------------------------------------------------------
// Sensitive data sanitizer — prevents secrets from leaking in logs/responses
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /session/i,
  /credit[_-]?card/i,
  /ssn/i,
  /cvv/i,
];

const SENSITIVE_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_.]+/gi,
  /sk-[A-Za-z0-9]{20,}/gi, // OpenAI/Anthropic keys
  /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, // JWT
];

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[max-depth]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    let clean = value;
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      clean = clean.replace(pattern, '[REDACTED]');
    }
    return clean.length > 500 ? clean.slice(0, 500) + '…' : clean;
  }

  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => sanitizeForLog(v, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(key))) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeForLog(val, depth + 1);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Normalization — turn any thrown value into an AppError
// ---------------------------------------------------------------------------

export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof Error) {
    // Prisma unique constraint violation
    const code = (err as { code?: string }).code;
    if (code === 'P2002') {
      return new ConflictError('Такая запись уже существует');
    }
    if (code === 'P2025') {
      return new NotFoundError('Запись');
    }
    // Prisma connection errors
    if (code?.startsWith('P10')) {
      return new DatabaseError('connection', err);
    }

    // Anthropic SDK errors
    if (err.name === 'APIError' || err.constructor.name === 'APIError') {
      return new AiModelError(err);
    }

    // Timeout
    if (err.name === 'AbortError' || err.message.includes('timeout')) {
      return new ExternalApiError('unknown', err, true);
    }

    return new AppError({
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      userMessage: 'Что-то пошло не так. Мы уже разбираемся.',
      internalMessage: err.message,
      cause: err,
    });
  }

  return new AppError({
    code: 'INTERNAL_ERROR',
    statusCode: 500,
    userMessage: 'Что-то пошло не так. Мы уже разбираемся.',
    internalMessage: String(err),
  });
}

// ---------------------------------------------------------------------------
// Response shape — what the client receives
// ---------------------------------------------------------------------------

/**
 * Response shape sent to the client.
 *
 * Intentionally backward compatible with the previous handler which used
 * flat { error: string, message: string } — existing mobile clients still
 * parse those fields. New clients should prefer `code` and `error.code`.
 */
export interface ErrorResponse {
  ok: false;
  // Legacy flat fields (existing mobile clients)
  error: string;
  message: string;
  // New structured fields (preferred for new clients)
  code: ErrorCodeKey;
  details?: Record<string, unknown>;
  requestId?: string;
}

function legacyErrorKey(code: ErrorCodeKey): string {
  // Maps new codes to legacy short keys the mobile app already handles
  if (code === 'VALIDATION_FAILED' || code === 'INVALID_INPUT' || code === 'MISSING_REQUIRED_FIELD') return 'validation';
  if (code === 'NOT_FOUND') return 'not_found';
  if (code === 'CONFLICT' || code === 'ALREADY_EXISTS') return 'conflict';
  if (code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID_TOKEN' || code === 'AUTH_EXPIRED_TOKEN') return 'unauthorized';
  if (code === 'AUTH_FORBIDDEN') return 'forbidden';
  if (code === 'RATE_LIMITED') return 'rate_limited';
  if (code === 'DATABASE_ERROR' || code === 'TRANSACTION_FAILED') return 'db_error';
  if (code === 'AI_MODEL_FAILED') return 'ai_error';
  if (code === 'EXTERNAL_API_FAILED' || code === 'EXTERNAL_API_TIMEOUT' || code === 'EXTERNAL_API_UNAVAILABLE') return 'external_error';
  return 'internal';
}

export function toErrorResponse(err: AppError, requestId?: string): ErrorResponse {
  const response: ErrorResponse = {
    ok: false,
    error: legacyErrorKey(err.code),
    message: err.userMessage,
    code: err.code,
  };
  if (err.details) {
    response.details = sanitizeForLog(err.details) as Record<string, unknown>;
  }
  if (requestId) {
    response.requestId = requestId;
  }
  return response;
}
