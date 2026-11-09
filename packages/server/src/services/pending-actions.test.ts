import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  setPendingAction,
  isSlotAnswer,
  peekPendingAction,
  takePendingAction,
  clearPendingAction,
  readConfirmSignal,
  awaitingSlot,
  PENDING_TTL_MS,
  type PendingStore,
  type PendingAction,
  clientPendingInput,
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

describe('clientPendingInput — служебные __-ключи не уходят клиенту (ревью-3 N6)', () => {
  it('убирает __advanceDealId/__partial/__source, оставляет протокол слота мобилки', () => {
    expect(
      clientPendingInput({ amount: 1, source: 's', __advanceDealId: 'd', __partial: true, __source: 'x', __awaitingSource: true, __awaitingCategory: true }),
    ).toEqual({ amount: 1, source: 's', __awaitingSource: true, __awaitingCategory: true });
  });
  it('без служебных ключей — тот же набор полей', () => {
    expect(clientPendingInput({ dealId: 'd', markWon: true, amount: 5 })).toEqual({ dealId: 'd', markWon: true, amount: 5 });
  });
});

describe('isSlotAnswer — ответ на «Откуда доход?/На что?» vs новая просьба', () => {
  it.each(['от работы', 'Серик', 'фриланс', 'такси', 'клиент Ахмет', 'кафе с друзьями'])('«%s» — ответ', (t) => {
    expect(isSlotAnswer(t)).toBe(true);
  });
  it.each(['на еду в месяц не больше 50000', 'отменить задачу', 'получил 2 письма от Серика', 'какие задачи на сегодня?', 'создай задачу купить хлеб'])(
    '«%s» — новая просьба',
    (t) => {
      expect(isSlotAnswer(t)).toBe(false);
    },
  );
});

import { BATCH_ACTION, stripConfirmTail } from './pending-actions.js';
describe('M9: несколько вопросов «да?» за ход — один общий', () => {
  it('в одном ходе склеиваются, одинаковые не дублируются; вне хода — затирают как раньше', async () => {
    const store = makeStore();
    await clearPendingAction(U, store); // хранилище общее на файл — начинаем с чистого
    const turn = { staged: new Set<string>() };
    await setPendingAction(U, 'delete_expense', { id: 'taxi' }, 'Удалить трату 5000 ₸ (такси)? Подтверди — удалю.', store, turn);
    const text = await setPendingAction(U, 'delete_expense', { id: 'coffee' }, 'Удалить трату 1500 ₸ (кофе)? Подтверди — удалю.', store, turn);
    await setPendingAction(U, 'delete_expense', { id: 'coffee' }, 'Удалить трату 1500 ₸ (кофе)? Подтверди — удалю.', store, turn);
    const p = await peekPendingAction(U, store);
    expect(p?.action).toBe(BATCH_ACTION);
    expect((p?.input.items as unknown[]).length).toBe(2);
    expect(text).toBe('Нужно твоё «да» на 2 вещи:\n• Удалить трату 5000 ₸ (такси)\n• Удалить трату 1500 ₸ (кофе)\nПодтвердить всё?');
    await setPendingAction(U, 'add_income', { amount: 1 }, 'Записать доход 1 ₸?', store, null);
    expect((await peekPendingAction(U, store))?.action).toBe('add_income');
  });

  it('слот «откуда доход?» не склеивается', async () => {
    const store = makeStore();
    await clearPendingAction(U, store);
    const turn = { staged: new Set<string>() };
    await setPendingAction(U, 'add_income', { amount: 5, __awaitingSource: true }, 'Откуда доход?', store, turn);
    await setPendingAction(U, 'delete_expense', { id: 'x' }, 'Удалить?', store, turn);
    expect((await peekPendingAction(U, store))?.action).toBe('delete_expense');
  });

  it('stripConfirmTail / clientPendingInput для пунктов', () => {
    expect(stripConfirmTail('Записать расход 3000 ₸ (обед)? Подтверди — запишу.')).toBe('Записать расход 3000 ₸ (обед)');
    expect(clientPendingInput({ items: [{ action: 'a', text: 't', input: { amount: 1, __source: 'x' } }] })).toEqual({
      items: [{ action: 'a', text: 't', input: { amount: 1 } }],
    });
  });
});
