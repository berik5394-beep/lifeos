/**
 * Бюджет на ожидание промиса. Если `promise` не зарезолвился за `ms` —
 * возвращаем `fallback` (НЕ ждём дальше). Никогда НЕ бросает: reject
 * исходного промиса тоже → fallback. Таймер чистится при оседании.
 *
 * Зачем: best-effort обогащение (память/pgvector) await-ится в горячем
 * пути чата — зависший тиер блокировал ответ юзеру без верхней границы.
 * Лежащий промис продолжает крутиться в фоне (его .catch'и его глушат),
 * мы просто перестаём его ждать.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const done = (v: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => done(fallback), ms);
    promise.then(
      (v) => done(v),
      () => done(fallback),
    );
  });
}
