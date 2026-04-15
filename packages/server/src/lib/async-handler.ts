/**
 * Async handler utilities.
 *
 * `requireUserId` — throws AuthError if request has no userId (belt and
 * suspenders — auth middleware should already enforce this, but this gives
 * route handlers a typed non-null userId).
 *
 * `tryAsync` — wraps a promise and returns a Result-style tuple. Useful
 * when a failure is expected and shouldn't propagate to the error handler.
 */

import type { FastifyRequest } from 'fastify';
import { AuthError } from './errors.js';

export function requireUserId(request: FastifyRequest): string {
  const userId = (request as FastifyRequest & { userId?: string }).userId;
  if (!userId) {
    throw new AuthError('AUTH_REQUIRED', 'Требуется авторизация');
  }
  return userId;
}

export type AsyncResult<T> = [T, null] | [null, Error];

export async function tryAsync<T>(promise: Promise<T>): Promise<AsyncResult<T>> {
  try {
    const value = await promise;
    return [value, null];
  } catch (err) {
    return [null, err instanceof Error ? err : new Error(String(err))];
  }
}
