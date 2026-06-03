import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  setPendingAction,
  peekPendingAction,
  takePendingAction,
  clearPendingAction,
  readConfirmSignal,
  awaitingSlot,
  PENDING_TTL_MS,
  type PendingStore,
  type PendingAction,
} from './pending-actions.js';

/**
 * Гейт подтверждения — критичный денежный путь. readConfirmSignal —
 * чистая логика. FSM/TTL/restart — через инъектируемый стор (без БД).
 * «Переживает рестарт» моделируем персистентным бэкендом, который
 * живёт ВНЕ обёртки (как таблица Postgres вне процесса).
 */

const U = 'user-test-1';

describe('readConfirmSignal — распознавание да/нет', () => {
  it.each(['да', 'Да', 'ага', 'угу', 'давай', 'подтверждаю', 'ок', 'окей', 'конечно', 'го', 'yes'])(
    '«%s» → confirm',
    (w) => expect(readConfirmSignal(w)).toBe('confirm'),
  );

  it.each(['нет', 'неа', 'не надо', 'отмена', 'отмени', 'отставить', 'no', 'cancel'])(
    '«%s» → cancel',
    (w) => expect(readConfirmSignal(w)).toBe('cancel'),
  );

  it('пунктуация после слова не мешает', () => {
    expect(readConfirmSignal('да!')).toBe('confirm');
    expect(readConfirmSignal('нет.')).toBe('cancel');
  });

  it('«да я ещё хотел добавить...» НЕ слепое подтверждение', () => {
    expect(readConfirmSignal('да я ещё хотел добавить задачу')).toBeNull();
  });

  it('нерелевантная фраза → null', () => {
    expect(readConfirmSignal('какая погода завтра')).toBeNull();
  });
});

/**
 * Персистентный бэкенд = «таблица Postgres». Живёт вне обёртки —
 * пересоздание обёртки моделирует рестарт процесса (та же БД).
 */
const backing = new Map<string, PendingAction>();
function makeStore(): PendingStore {
  return {
    async save(userId, rec) {
      backing.set(userId, { ...rec });
    },
    async load(userId) {
      const r = backing.get(userId);
      return r ? { ...r } : null;
    },
    async remove(userId) {
      backing.delete(userId);
    },
    // Атомарно (get+delete без await между ними) — моделирует
    // Postgres DELETE…RETURNING: consume-once даже при гонке.
    async take(userId) {
      const r = backing.get(userId);
      backing.delete(userId);
      return r ? { ...r } : null;
    },
  };
}

describe('awaitingSlot — состояние слот-филла', () => {
  const base: PendingAction = { action: 'add_expense', input: {}, confirmationText: 'q', createdAt: 0 };
  it('category', () => {
    expect(awaitingSlot({ ...base, input: { amount: 100, __awaitingCategory: true } })).toBe('category');
  });
  it('source', () => {
    expect(awaitingSlot({ ...base, action: 'add_income', input: { amount: 100, __awaitingSource: true } })).toBe('source');
  });
  it('обычный confirm-pending → null', () => {
    expect(awaitingSlot({ ...base, input: { amount: 100, category: 'еда' } })).toBeNull();
  });
});

describe('confirm-FSM — set/peek/take/clear (инъектируемый стор)', () => {
  beforeEach(() => backing.clear());

  it('set → peek возвращает то же, не удаляя', async () => {
    const s = makeStore();
    await setPendingAction(U, 'add_expense', { amount: 3000 }, 'Записать 3000 ₸?', s);
    const p1 = await peekPendingAction(U, s);
    expect(p1?.action).toBe('add_expense');
    expect(p1?.input.amount).toBe(3000);
    expect(await peekPendingAction(U, s)).not.toBeNull();
  });

  it('take возвращает и удаляет (одноразово)', async () => {
    const s = makeStore();
    await setPendingAction(U, 'add_income', { amount: 100 }, 'q', s);
    expect((await takePendingAction(U, s))?.action).toBe('add_income');
    expect(await takePendingAction(U, s)).toBeNull();
  });

  it('изоляция по userId', async () => {
    const s = makeStore();
    await setPendingAction(U, 'add_expense', { amount: 1 }, 'q', s);
    expect(await peekPendingAction('other-user', s)).toBeNull();
  });

  it('ГОНКА: два одновременных «да» → ровно ОДИН берёт действие (нет дубля денег)', async () => {
    const s = makeStore();
    await setPendingAction(U, 'add_expense', { amount: 100000 }, 'q', s);
    const [a, b] = await Promise.all([takePendingAction(U, s), takePendingAction(U, s)]);
    const got = [a, b].filter((x) => x !== null);
    expect(got).toHaveLength(1); // ровно один — второй получил null
    expect(got[0]?.action).toBe('add_expense');
  });
});

describe('pending-actions — прод-стор атомарен (structural)', () => {
  it('take использует prisma.pendingAction.delete (DELETE…RETURNING), не load+remove', () => {
    const SRC = readFileSync(join(process.cwd(), 'src/services/pending-actions.ts'), 'utf-8');
    expect(SRC).toMatch(/take\(userId\)[\s\S]*?prisma\.pendingAction\.delete/);
    expect(SRC).toContain("e.code === 'P2025'");
    // takePendingAction должен звать store.take, а не peek+remove
    expect(SRC).toMatch(/takePendingAction[\s\S]*?store\.take\(userId\)/);
  });
});

describe('confirm-FSM — 4 сценария спеки', () => {
  beforeEach(() => backing.clear());

  it('«да» через 30 секунд → pending жив, подтверждается', async () => {
    const s = makeStore();
    await setPendingAction(U, 'add_income', { amount: 150000 }, 'q', s);
    backing.get(U)!.createdAt = Date.now() - 30_000; // 30с назад
    const p = await takePendingAction(U, s);
    expect(p?.action).toBe('add_income');
    expect(p?.input.amount).toBe(150000);
  });

  it('«да» через 6 минут → TTL истёк, НЕ исполняется, строка удалена', async () => {
    const s = makeStore();
    await setPendingAction(U, 'add_expense', { amount: 40000 }, 'q', s);
    backing.get(U)!.createdAt = Date.now() - (PENDING_TTL_MS + 60_000); // 6 мин
    expect(await peekPendingAction(U, s)).toBeNull();
    expect(backing.has(U)).toBe(false); // протухшее удалено
    expect(await takePendingAction(U, s)).toBeNull();
  });

  it('новый несвязанный запрос отменяет pending (clear)', async () => {
    const s = makeStore();
    await setPendingAction(U, 'add_expense', { amount: 5000 }, 'q', s);
    await clearPendingAction(U, s); // оркестратор делает это при смене темы
    expect(await peekPendingAction(U, s)).toBeNull();
  });

  it('рестарт сервера НЕ теряет pending (персистентный бэкенд)', async () => {
    const before = makeStore();
    await setPendingAction(U, 'add_income', { amount: 150000 }, 'зарплата', before);
    // «рестарт»: новый процесс, новая обёртка, та же БД (backing)
    const afterRestart = makeStore();
    const p = await peekPendingAction(U, afterRestart);
    expect(p?.action).toBe('add_income');
    expect(p?.input.amount).toBe(150000);
    expect(p?.confirmationText).toBe('зарплата');
  });
});
