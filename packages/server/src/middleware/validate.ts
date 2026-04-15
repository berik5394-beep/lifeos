import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ZodSchema } from 'zod';
import { ValidationError } from '../lib/errors.js';

/**
 * Валидация тела/квери/парамов запроса через Zod.
 *
 * Раньше возвращал 400 напрямую через reply.status().send(). Теперь бросает
 * ValidationError — чтобы глобальный registerErrorHandler нормализовал ответ
 * в единый формат (ok, code, message, details, requestId). Поле errors из
 * zod.flatten() кладём в details.errors, чтобы не ломать потенциальных
 * клиентов которые смотрят в details.
 *
 * `source` по умолчанию 'body' — чтобы существующие вызовы `validate(schema)`
 * продолжали работать без изменений.
 */
export function validate(
  schema: ZodSchema,
  source: 'body' | 'query' | 'params' = 'body',
) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const payload =
      source === 'body'
        ? request.body
        : source === 'query'
          ? request.query
          : request.params;

    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new ValidationError('Ошибка валидации', {
        source,
        errors: result.error.flatten().fieldErrors,
      });
    }

    // Подменяем только соответствующий источник — чтобы типы совпадали
    // с z.infer<typeof schema> на стороне хендлера.
    if (source === 'body') {
      request.body = result.data;
    } else if (source === 'query') {
      request.query = result.data as typeof request.query;
    } else {
      request.params = result.data as typeof request.params;
    }
  };
}

// ============================================================================
// Валидация query-параметров дат
// ============================================================================

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/; // YYYY-MM
const YEAR_RE = /^\d{4}$/; // YYYY

/** Проверяет, что строка — валидная дата YYYY-MM-DD и парсит её */
export function parseDate(value: string): Date | null {
  if (!ISO_DATE_RE.test(value)) return null;
  const d = new Date(value + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  return d;
}

/** Проверяет формат YYYY-MM и возвращает { start, end } для месяца */
export function parseMonth(value: string): { start: Date; end: Date } | null {
  if (!MONTH_RE.test(value)) return null;
  const [year, m] = value.split('-').map(Number);
  const start = new Date(year, m - 1, 1);
  const end = new Date(year, m, 1);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  return { start, end };
}

/** Проверяет формат YYYY и возвращает число */
export function parseYear(value: string): number | null {
  if (!YEAR_RE.test(value)) return null;
  const y = Number(value);
  if (y < 2000 || y > 2100) return null;
  return y;
}

/** Стандартный 400 ответ для невалидного формата даты */
export function invalidDateReply(reply: FastifyReply, param: string, expected: string) {
  return reply.status(400).send({
    message: `Неверный формат параметра "${param}". Ожидается: ${expected}`,
  });
}
