import { describe, it, expect, beforeEach } from 'vitest';
import {
  setPendingAction,
  peekPendingAction,
  takePendingAction,
  clearPendingAction,
  readConfirmSignal,
} from './pending-actions.js';

/**
 * Гейт подтверждения — критичный денежный путь (Phase 1.2). Раньше
 * был без тестов (отмечено в аудите). Это чистая in-memory логика,
 * тестируется без БД.
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

  it('«да я ещё хотел добавить...» НЕ слепое подтверждение (длинная фраза)', () => {
    expect(readConfirmSignal('да я ещё хотел добавить задачу')).toBeNull();
  });

  it('нерелевантная фраза → null', () => {
    expect(readConfirmSignal('какая погода завтра')).toBeNull();
  });
});

describe('pending store — set/peek/take/clear', () => {
  beforeEach(() => clearPendingAction(U));

  it('set → peek возвращает то же, не удаляя', () => {
    setPendingAction(U, 'add_expense', { amount: 3000 }, 'Записать расход 3000 ₸?');
    const p1 = peekPendingAction(U);
    expect(p1?.action).toBe('add_expense');
    expect(p1?.input.amount).toBe(3000);
    expect(peekPendingAction(U)).not.toBeNull(); // peek не потребляет
  });

  it('take возвращает и удаляет (одноразово)', () => {
    setPendingAction(U, 'add_income', { amount: 100 }, 'q');
    expect(takePendingAction(U)?.action).toBe('add_income');
    expect(takePendingAction(U)).toBeNull(); // уже забрали
  });

  it('clear убирает pending', () => {
    setPendingAction(U, 'send_telegram', { text: 'hi' }, 'q');
    clearPendingAction(U);
    expect(peekPendingAction(U)).toBeNull();
  });

  it('изоляция по userId', () => {
    setPendingAction(U, 'add_expense', { amount: 1 }, 'q');
    expect(peekPendingAction('other-user')).toBeNull();
  });
});
