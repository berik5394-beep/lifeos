import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  AuthError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ExternalApiError,
  AiModelError,
  DatabaseError,
  sanitizeForLog,
  normalizeError,
  toErrorResponse,
} from './errors.js';

// ---------------------------------------------------------------------------
// AppError + specialised classes
// ---------------------------------------------------------------------------

describe('AppError', () => {
  it('captures code, statusCode, userMessage and marks isOperational', () => {
    const err = new AppError({
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      userMessage: 'boom',
    });
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.userMessage).toBe('boom');
    expect(err.isOperational).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });

  it('uses internalMessage for Error.message when provided, falls back to userMessage', () => {
    const withInternal = new AppError({
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      userMessage: 'user-facing',
      internalMessage: 'internal detail',
    });
    expect(withInternal.message).toBe('internal detail');

    const withoutInternal = new AppError({
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      userMessage: 'user-facing',
    });
    expect(withoutInternal.message).toBe('user-facing');
  });

  it('attaches cause when cause is an Error', () => {
    const root = new Error('root');
    const err = new AppError({
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      userMessage: 'x',
      cause: root,
    });
    expect(err.cause).toBe(root);
  });
});

describe('specialised error classes', () => {
  it('ValidationError → 400 + VALIDATION_FAILED', () => {
    const err = new ValidationError('bad field', { field: 'email' });
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ field: 'email' });
  });

  it('AuthError → 401 by default, 403 for AUTH_FORBIDDEN', () => {
    const required = new AuthError();
    expect(required.statusCode).toBe(401);
    expect(required.code).toBe('AUTH_REQUIRED');

    const forbidden = new AuthError('AUTH_FORBIDDEN', 'нельзя');
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.code).toBe('AUTH_FORBIDDEN');
  });

  it('NotFoundError → 404', () => {
    const err = new NotFoundError('Task');
    expect(err.statusCode).toBe(404);
    expect(err.userMessage).toContain('Task');
  });

  it('ConflictError → 409', () => {
    const err = new ConflictError('duplicate');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
  });

  it('RateLimitError → 429 with retryAfterSec', () => {
    const err = new RateLimitError(42);
    expect(err.statusCode).toBe(429);
    expect(err.details).toEqual({ retryAfterSec: 42 });
  });

  it('ExternalApiError: 502 normally, 504 on timeout', () => {
    expect(new ExternalApiError('svc').statusCode).toBe(502);
    expect(new ExternalApiError('svc', undefined, true).statusCode).toBe(504);
    expect(new ExternalApiError('svc', undefined, true).code).toBe('EXTERNAL_API_TIMEOUT');
  });

  it('AiModelError → 503', () => {
    const err = new AiModelError();
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('AI_MODEL_FAILED');
  });

  it('DatabaseError → 500 + DATABASE_ERROR', () => {
    const err = new DatabaseError('insert');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('DATABASE_ERROR');
  });
});

// ---------------------------------------------------------------------------
// sanitizeForLog
// ---------------------------------------------------------------------------

describe('sanitizeForLog', () => {
  it('redacts sensitive keys at any depth', () => {
    const input = {
      email: 'a@b.com',
      password: 'hunter2',
      nested: {
        token: 'sk-abcdef1234567890abcdef',
        authorization: 'Bearer xxx',
      },
    };
    const out = sanitizeForLog(input) as Record<string, unknown>;
    expect(out.email).toBe('a@b.com');
    expect(out.password).toBe('[REDACTED]');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.token).toBe('[REDACTED]');
    expect(nested.authorization).toBe('[REDACTED]');
  });

  it('redacts Bearer tokens, sk- keys and JWTs inside strings', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const s1 = sanitizeForLog('Authorization: Bearer abc.def-123') as string;
    const s2 = sanitizeForLog(`key=sk-abcdefghijklmnopqrstuv`) as string;
    const s3 = sanitizeForLog(jwt) as string;
    expect(s1).toContain('[REDACTED]');
    expect(s2).toContain('[REDACTED]');
    expect(s3).toContain('[REDACTED]');
  });

  it('truncates overly long strings at 500 chars', () => {
    const long = 'x'.repeat(1000);
    const out = sanitizeForLog(long) as string;
    expect(out.length).toBeLessThanOrEqual(501);
    expect(out.endsWith('…')).toBe(true);
  });

  it('caps array length at 20 and recurses into items', () => {
    const arr = Array.from({ length: 30 }, (_, i) => ({ password: String(i) }));
    const out = sanitizeForLog(arr) as unknown[];
    expect(out.length).toBe(20);
    expect((out[0] as Record<string, unknown>).password).toBe('[REDACTED]');
  });

  it('returns [max-depth] beyond depth 6', () => {
    // build nested: level0 -> level1 -> ... -> level7
    let node: Record<string, unknown> = { leaf: 'deep' };
    for (let i = 0; i < 10; i++) node = { next: node };
    const out = sanitizeForLog(node);
    // should not throw; stringify must succeed
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('passes through null/undefined/primitives', () => {
    expect(sanitizeForLog(null)).toBeNull();
    expect(sanitizeForLog(undefined)).toBeUndefined();
    expect(sanitizeForLog(42)).toBe(42);
    expect(sanitizeForLog(true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeError
// ---------------------------------------------------------------------------

describe('normalizeError', () => {
  it('passes AppError through unchanged', () => {
    const err = new NotFoundError('Task');
    expect(normalizeError(err)).toBe(err);
  });

  it('maps Prisma P2002 → ConflictError (409)', () => {
    const prismaErr = Object.assign(new Error('unique constraint'), { code: 'P2002' });
    const out = normalizeError(prismaErr);
    expect(out.statusCode).toBe(409);
    expect(out.code).toBe('CONFLICT');
  });

  it('maps Prisma P2025 → NotFoundError (404)', () => {
    const prismaErr = Object.assign(new Error('not found'), { code: 'P2025' });
    const out = normalizeError(prismaErr);
    expect(out.statusCode).toBe(404);
    expect(out.code).toBe('NOT_FOUND');
  });

  it('maps Prisma P10xx → DatabaseError', () => {
    const prismaErr = Object.assign(new Error('connection refused'), { code: 'P1001' });
    const out = normalizeError(prismaErr);
    expect(out.statusCode).toBe(500);
    expect(out.code).toBe('DATABASE_ERROR');
  });

  it('maps Anthropic APIError name → AiModelError', () => {
    const apiErr = Object.assign(new Error('rate limited'), { name: 'APIError' });
    const out = normalizeError(apiErr);
    expect(out.statusCode).toBe(503);
    expect(out.code).toBe('AI_MODEL_FAILED');
  });

  it('maps AbortError / timeout message → ExternalApiError timeout (504)', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const out1 = normalizeError(abort);
    expect(out1.statusCode).toBe(504);
    expect(out1.code).toBe('EXTERNAL_API_TIMEOUT');

    const timeout = new Error('upstream timeout reached');
    const out2 = normalizeError(timeout);
    expect(out2.statusCode).toBe(504);
  });

  it('wraps unknown Error → INTERNAL_ERROR 500', () => {
    const out = normalizeError(new Error('surprise'));
    expect(out.statusCode).toBe(500);
    expect(out.code).toBe('INTERNAL_ERROR');
  });

  it('wraps non-Error throws → INTERNAL_ERROR', () => {
    const out = normalizeError('string throw');
    expect(out.statusCode).toBe(500);
    expect(out.code).toBe('INTERNAL_ERROR');
  });
});

// ---------------------------------------------------------------------------
// toErrorResponse
// ---------------------------------------------------------------------------

describe('toErrorResponse', () => {
  it('keeps backward-compat flat fields (error, message) alongside new code', () => {
    const err = new ValidationError('bad', { field: 'x' });
    const resp = toErrorResponse(err, 'req-123');
    expect(resp.ok).toBe(false);
    expect(resp.error).toBe('validation'); // legacy short key
    expect(resp.message).toBe('bad'); // legacy message field
    expect(resp.code).toBe('VALIDATION_FAILED');
    expect(resp.requestId).toBe('req-123');
  });

  it('maps auth codes to legacy "unauthorized"/"forbidden"', () => {
    expect(toErrorResponse(new AuthError('AUTH_REQUIRED')).error).toBe('unauthorized');
    expect(toErrorResponse(new AuthError('AUTH_FORBIDDEN', 'нельзя')).error).toBe('forbidden');
  });

  it('sanitises details before sending', () => {
    const err = new ValidationError('bad', { password: 'hunter2', email: 'a@b.com' });
    const resp = toErrorResponse(err);
    const details = resp.details as Record<string, unknown>;
    expect(details.password).toBe('[REDACTED]');
    expect(details.email).toBe('a@b.com');
  });
});
