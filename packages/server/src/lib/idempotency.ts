import type { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * Idempotency-Key для записей с телефона. Офлайн-очередь повторяет запись,
 * если ответ потерялся в сети (сервер записал, телефон не узнал) — без ключа
 * трата/задача сохранялась дважды. Повтор с тем же ключом получает
 * сохранённый ответ. Без заголовка — поведение прежнее.
 *
 * Схема: сначала «заявка» (уникальная строка userId+key, statusCode=0),
 * потом запись, потом ответ в заявку. Два одновременных повтора: второй
 * видит заявку без ответа → 409 (очередь такой повтор выкидывает — первый
 * уже записал).
 */
const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
/** Ключи старше — удаляем (повторы очереди приходят в пределах дней). */
const KEEP_DAYS = 7;

export type IdemClaim =
  | { mode: 'none' }
  | { mode: 'claimed'; id: string }
  | { mode: 'replay'; statusCode: number; response: unknown }
  | { mode: 'busy' };

export function idempotencyKeyOf(request: FastifyRequest): string | null {
  const raw = request.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  return key && KEY_RE.test(key) ? key : null;
}

export async function claimIdempotency(request: FastifyRequest): Promise<IdemClaim> {
  const key = idempotencyKeyOf(request);
  if (!key) return { mode: 'none' };
  const userId = request.userId;
  try {
    const row = await prisma.idempotencyKey.create({ data: { userId, key }, select: { id: true } });
    // Изредка подчищаем старые ключи этого юзера (дёшево, по индексу).
    if (Math.random() < 0.05) {
      void prisma.idempotencyKey
        .deleteMany({ where: { userId, createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } })
        .catch(() => {});
    }
    return { mode: 'claimed', id: row.id };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    const prev = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
    if (prev && prev.statusCode > 0) return { mode: 'replay', statusCode: prev.statusCode, response: prev.response };
    return { mode: 'busy' };
  }
}

/** Ответ сохраняем в заявку — повтор получит его же. */
export async function rememberIdempotency(claim: IdemClaim, statusCode: number, response: unknown): Promise<void> {
  if (claim.mode !== 'claimed') return;
  await prisma.idempotencyKey
    .update({
      where: { id: claim.id },
      data: { statusCode, response: JSON.parse(JSON.stringify(response ?? null)) as Prisma.InputJsonValue },
    })
    .catch(() => {});
}

/** Запись упала — снять заявку, чтобы повтор смог выполниться. */
export async function releaseIdempotency(claim: IdemClaim): Promise<void> {
  if (claim.mode !== 'claimed') return;
  await prisma.idempotencyKey.delete({ where: { id: claim.id } }).catch(() => {});
}

/**
 * Обёртка обработчика записи: повтор → сохранённый ответ; занят → 409;
 * иначе выполнить и запомнить ответ (только успешный 2xx).
 */
export async function withIdempotency(
  request: FastifyRequest,
  reply: FastifyReply,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<FastifyReply> {
  const claim = await claimIdempotency(request);
  if (claim.mode === 'replay') return reply.status(claim.statusCode).send(claim.response);
  if (claim.mode === 'busy') return reply.status(409).send({ message: 'Эта запись уже сохраняется' });
  try {
    const { status, body } = await run();
    if (status >= 200 && status < 300) await rememberIdempotency(claim, status, body);
    else await releaseIdempotency(claim);
    return reply.status(status).send(body);
  } catch (err) {
    await releaseIdempotency(claim);
    throw err;
  }
}
