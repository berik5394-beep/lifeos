/**
 * Centralized error-handling middleware for Fastify.
 *
 * Replaces the scattered try/catch + manual reply.status() pattern with a
 * single source of truth:
 *   - Any thrown error anywhere in a route handler hits this function
 *   - Errors are normalized to AppError
 *   - Sensitive fields are stripped before logging
 *   - Client receives a stable { ok: false, error: {...} } shape
 *   - Zod validation errors are translated to user-friendly Russian messages
 */

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  AppError,
  ValidationError,
  normalizeError,
  toErrorResponse,
} from '../lib/errors.js';
import { logger } from '../lib/logger.js';

function zodToValidationError(err: ZodError): ValidationError {
  const firstIssue = err.issues[0];
  const field = firstIssue?.path.join('.') ?? 'unknown';
  const msg = firstIssue?.message ?? 'Неверные данные';

  return new ValidationError(`Ошибка в поле "${field}": ${msg}`, {
    issues: err.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    })),
  });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((rawError: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    let appError: AppError;

    if (rawError instanceof ZodError) {
      appError = zodToValidationError(rawError);
    } else if (rawError.validation) {
      // Fastify schema validation error
      appError = new ValidationError(
        rawError.message || 'Неверные данные запроса',
        { validation: rawError.validation },
      );
    } else if ((rawError as FastifyError).statusCode === 413) {
      appError = new ValidationError('Файл слишком большой');
    } else {
      appError = normalizeError(rawError);
    }

    const requestId = request.id;

    // Log at appropriate level — 4xx is user error (warn), 5xx is our bug (error)
    const logContext = {
      requestId,
      method: request.method,
      url: request.url,
      userId: (request as FastifyRequest & { userId?: string }).userId,
      code: appError.code,
      statusCode: appError.statusCode,
    };

    if (appError.statusCode >= 500) {
      logger.error('request_failed', logContext, rawError);
    } else {
      logger.warn('request_rejected', logContext);
    }

    return reply.status(appError.statusCode).send(toErrorResponse(appError, requestId));
  });

  // Not-found handler — ensures consistent shape for unknown routes
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(404).send({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: `Маршрут ${request.method} ${request.url} не существует`,
        requestId: request.id,
      },
    });
  });
}
