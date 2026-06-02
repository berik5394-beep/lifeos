import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Confirm-FSM (SSOT Step 4). Денежные/необратимые действия не
 * выполняются сразу — сначала «записать?», юзер подтверждает «да»
 * (Telegram/голос) или кнопкой (/voice/confirm-action).
 *
 * Хранилище — Postgres (таблица PendingAction), НЕ in-memory.
 * Прежний `const store = new Map` жил в процессе и терялся при
 * рестарте Railway: юзер говорил «да», а подтверждать уже нечего —
 * деньги молча не записывались. Теперь pending переживает рестарт.
 *
 * TTL 5 минут проверяется ПРИ ЧТЕНИИ (lazy expire + delete) —
 * подтверждение это «прямо сейчас», протухшее не должно сработать.
 * Отдельный sweeper не нужен: строк максимум одна на юзера, она
 * перетирается новым предложением или удаляется при peek/take.
 *
 * Store инъектируем (порт) — FSM/TTL тестируются без БД, а
 * «переживает рестарт» моделируется персистентным фейк-портом.
 */

export const PENDING_TTL_MS = 5 * 60 * 1000;

export interface PendingAction {
  action: string;
  input: Record<string, unknown>;
  confirmationText: string;
  /** epoch ms — для TTL. */
  createdAt: number;
}

export interface PendingStore {
  save(userId: string, rec: PendingAction): Promise<void>;
  load(userId: string): Promise<PendingAction | null>;
  remove(userId: string): Promise<void>;
}

const prismaPendingStore: PendingStore = {
  async save(userId, rec) {
    const data = {
      action: rec.action,
      inputJson: rec.input as Prisma.InputJsonValue,
      confirmationText: rec.confirmationText,
      createdAt: new Date(rec.createdAt),
    };
    await prisma.pendingAction.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  },
  async load(userId) {
    const row = await prisma.pendingAction.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      action: row.action,
      input: (row.inputJson ?? {}) as Record<string, unknown>,
      confirmationText: row.confirmationText,
      createdAt: row.createdAt.getTime(),
    };
  },
  async remove(userId) {
    // deleteMany — не бросает, если строки нет (идемпотентно).
    await prisma.pendingAction.deleteMany({ where: { userId } });
  },
};

export async function setPendingAction(
  userId: string,
  action: string,
  input: Record<string, unknown>,
  confirmationText: string,
  store: PendingStore = prismaPendingStore,
): Promise<void> {
  await store.save(userId, {
    action,
    input,
    confirmationText,
    createdAt: Date.now(),
  });
}

/** Свежий pending (или null если нет/протух). Протухший удаляет. */
export async function peekPendingAction(
  userId: string,
  store: PendingStore = prismaPendingStore,
): Promise<PendingAction | null> {
  const p = await store.load(userId);
  if (!p) return null;
  if (Date.now() - p.createdAt > PENDING_TTL_MS) {
    await store.remove(userId);
    return null;
  }
  return p;
}

/** Забирает и удаляет pending (подтверждение/отмена). */
export async function takePendingAction(
  userId: string,
  store: PendingStore = prismaPendingStore,
): Promise<PendingAction | null> {
  const p = await peekPendingAction(userId, store);
  if (p) await store.remove(userId);
  return p;
}

export async function clearPendingAction(
  userId: string,
  store: PendingStore = prismaPendingStore,
): Promise<void> {
  await store.remove(userId);
}

/**
 * Ждёт ли pending значение слота (категория расхода / источник дохода)?
 * Состояние — флаг в input JSON (durable, без миграции). #189: чтобы
 * многошаговый ввод денег («100000» → «компьютер» → «да») шёл через FSM,
 * а не сочинялся чат-агентом. Чистая.
 */
export function awaitingSlot(p: PendingAction): 'category' | 'source' | null {
  if (p.input.__awaitingCategory) return 'category';
  if (p.input.__awaitingSource) return 'source';
  return null;
}

// -----------------------------------------------------------------------------
// Распознавание «да/нет» в свободной речи (Telegram, голос). Чистая
// функция (без БД). НЕ \b — в JS \w=[A-Za-z0-9_], кириллическая
// граница не срабатывает. Только короткое чистое да/нет — чтобы
// «да я кстати ещё...» не было слепым подтверждением.
// -----------------------------------------------------------------------------

const AFFIRM =
  /^(да|ага|угу|давай(те)?|подтвержда[юй]|подтверди(ть)?|ок(ей)?|ok(ay)?|конечно|точно|верно|правильно|записывай|запиши|го|yes|yep|yeah|y)[\s!.,)]*$/i;

const NEGATE =
  /^(нет|неа|не надо|не нужно|не записывай|не записывать|отмена|отмен[аияй]+|отставить|cancel|no|nope|n)[\s!.,)]*$/i;

export type ConfirmSignal = 'confirm' | 'cancel' | null;

export function readConfirmSignal(text: string): ConfirmSignal {
  const t = text.trim();
  if (AFFIRM.test(t)) return 'confirm';
  if (NEGATE.test(t)) return 'cancel';
  return null;
}
