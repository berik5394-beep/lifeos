import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ход разговора (одно сообщение юзера). Нужен глубоким местам (setPendingAction в
 * инструментах, движке переносов, агенте), чтобы знать «это тот же ход»:
 * несколько вопросов «да?» за ход собираются в один (аудит 2026-11-09, M9).
 * staged — кому В ЭТОМ ходе уже поставлен вопрос (точно, без сравнения времени).
 */
export interface TurnCtx {
  staged: Set<string>;
}

const store = new AsyncLocalStorage<TurnCtx>();

export function runInTurn<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ staged: new Set() }, fn);
}

/** Текущий ход или null вне хода (крон, REST). */
export function currentTurn(): TurnCtx | null {
  return store.getStore() ?? null;
}
