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
  /**
   * АТОМАРНО забрать и удалить (consume-once). Гарантия «ровно один»:
   * при гонке двух «да» (тап в app + «да» в Telegram, дабл-тап) только
   * ОДИН вызов вернёт запись, второй — null. Иначе — двойная запись денег.
   */
  take(userId: string): Promise<PendingAction | null>;
}

type PendingRow = {
  action: string;
  inputJson: Prisma.JsonValue | null;
  confirmationText: string;
  createdAt: Date;
};

function mapRow(row: PendingRow): PendingAction {
  return {
    action: row.action,
    input: (row.inputJson ?? {}) as Record<string, unknown>,
    confirmationText: row.confirmationText,
    createdAt: row.createdAt.getTime(),
  };
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
    return row ? mapRow(row) : null;
  },
  async remove(userId) {
    // deleteMany — не бросает, если строки нет (идемпотентно).
    await prisma.pendingAction.deleteMany({ where: { userId } });
  },
  async take(userId) {
    // АТОМАРНО: Postgres DELETE ... RETURNING. userId @unique → при гонке
    // двух «да» только ОДИН delete найдёт строку, второй бросит P2025 →
    // null. Так дубль записи денег невозможен (раньше: load+remove = гонка).
    try {
      const row = await prisma.pendingAction.delete({ where: { userId } });
      return mapRow(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return null; // строки нет (нет pending / проиграл гонку)
      }
      throw e;
    }
  },
};

/** Служебные ключи, которые клиент понимает: протокол слот-филла мобилки (isConfirmable). */
const CLIENT_VISIBLE_INTERNAL = new Set(['__awaitingCategory', '__awaitingSource']);

/**
 * Ревью-3 N6: input pending-а для КЛИЕНТА — без служебных `__*` (`__advanceDealId`,
 * `__partial`, `__source`…): это внутренняя кухня сервера. Протокол слота
 * (`__awaitingCategory/__awaitingSource`) остаётся — по нему мобилка прячет кнопки.
 */
export function clientPendingInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!k.startsWith('__') || CLIENT_VISIBLE_INTERNAL.has(k)) out[k] = v;
  }
  return out;
}

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

/**
 * Pending, поставленный НЕ раньше `since` (т.е. этим ходом — обычно агентом
 * внутри цикла: delete/edit_expense, set_balance…). Нужен, чтобы ответ хода
 * отдал его мобилке → кнопки «Подтвердить / Отмена». Старое предложение
 * прошлых ходов (≠ этот ход) не отдаём.
 */
export async function pendingStagedSince(
  userId: string,
  since: Date,
  store: PendingStore = prismaPendingStore,
): Promise<PendingAction | null> {
  const p = await peekPendingAction(userId, store);
  return p && p.createdAt >= since.getTime() ? p : null;
}

/**
 * Забирает и удаляет pending АТОМАРНО (consume-once). Гонку решает
 * store.take (Postgres DELETE…RETURNING), не load+remove. TTL проверяем
 * после: протухшее уже удалено, возвращаем null (не исполняем).
 */
export async function takePendingAction(
  userId: string,
  store: PendingStore = prismaPendingStore,
): Promise<PendingAction | null> {
  const p = await store.take(userId);
  if (!p) return null;
  if (Date.now() - p.createdAt > PENDING_TTL_MS) return null;
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

/**
 * Аудит 2026-11-09: на вопрос «Откуда доход?» / «На что потрачено?» ответ —
 * пара слов («от работы», «Серик», «такси»). Новая просьба («на еду в месяц не
 * больше 50000», «отменить задачу», «какие задачи?») — НЕ ответ: её нельзя
 * записывать в источник/категорию, вопрос снимаем и разбираем её как обычно.
 */
const SLOT_NOT_ANSWER =
  /^(?:создай|созда|запиш|запомн|постав|добав|напомн|отмет|закрой|закрыть|удал|убер|убра|перенес|перенос|сдвин|отмени|отменить|покажи|открой|сколько|какие|какой|какая|что\s|когда|где|как\s|почему|зачем|потратил|купил|получил|заработал|сделал|сегодня|завтра|вчера|на\s+(?:еду|месяц|неделю|завтра|сегодня)|хочу|надо|нужно|давай|лимит|бюджет|задач|привычк|цел[ьи]|встреч)/i;

export function isSlotAnswer(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!…]+$/u, '');
  if (!t || t.includes('?')) return false;
  if (/\d/.test(t)) return false;
  if (t.split(/\s+/).length > 5) return false;
  return !SLOT_NOT_ANSWER.test(t);
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
