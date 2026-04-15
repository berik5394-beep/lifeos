/**
 * Structured logger for LifeOS.
 *
 * Wraps Fastify's pino logger with:
 *  - Automatic sanitization of sensitive fields before output
 *  - Stable event naming for searchable logs
 *  - Safe error serialization (no stack traces leaking to prod clients)
 *
 * Use this instead of `console.log` or `app.log` directly.
 */

import { sanitizeForLog } from './errors.js';

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

type LogContext = Record<string, unknown>;

interface PinoLike {
  fatal: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  info: (obj: object, msg?: string) => void;
  debug: (obj: object, msg?: string) => void;
  trace: (obj: object, msg?: string) => void;
}

let underlying: PinoLike | null = null;

/**
 * Attach the underlying pino instance from Fastify. Call once at startup.
 * Before this is called, logs go to console as a fallback.
 */
export function attachLogger(pino: PinoLike): void {
  underlying = pino;
}

function fallbackLog(level: LogLevel, obj: object, msg?: string): void {
  const prefix = `[${level.toUpperCase()}]`;
  if (msg) {
    // eslint-disable-next-line no-console
    console.log(prefix, msg, JSON.stringify(obj));
  } else {
    // eslint-disable-next-line no-console
    console.log(prefix, JSON.stringify(obj));
  }
}

function write(level: LogLevel, event: string, context: LogContext = {}, err?: unknown): void {
  const sanitized = sanitizeForLog(context) as LogContext;

  const payload: LogContext = {
    event,
    ...sanitized,
  };

  if (err instanceof Error) {
    payload.error = {
      name: err.name,
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      code: (err as { code?: string }).code,
    };
  } else if (err !== undefined) {
    payload.error = sanitizeForLog(err);
  }

  if (underlying) {
    underlying[level](payload, event);
  } else {
    fallbackLog(level, payload, event);
  }
}

export const logger = {
  info: (event: string, context?: LogContext) => write('info', event, context),
  warn: (event: string, context?: LogContext, err?: unknown) => write('warn', event, context, err),
  error: (event: string, context?: LogContext, err?: unknown) => write('error', event, context, err),
  fatal: (event: string, context?: LogContext, err?: unknown) => write('fatal', event, context, err),
  debug: (event: string, context?: LogContext) => write('debug', event, context),
};
