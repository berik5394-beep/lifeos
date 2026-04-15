import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ZodSchema } from 'zod';

export function validate(schema: ZodSchema) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        message: 'Ошибка валидации',
        errors: result.error.flatten().fieldErrors,
      });
    }
    request.body = result.data;
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
