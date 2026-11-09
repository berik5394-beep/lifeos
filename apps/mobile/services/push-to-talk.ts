/**
 * Кнопка голоса — как в WhatsApp/Telegram (Berik 2026-11-09: «нажать один раз,
 * потом говорить, а потом отправить»):
 *  - короткое нажатие — запись включается и держится сама («зафиксирована»):
 *    говоришь сколько нужно, потом «отправить» (или ещё раз на кнопку) — фраза
 *    уходит; «отмена» — без отправки;
 *  - удержание — как раньше: держишь и говоришь, отпустил — отправилось.
 *
 * Запуск записи асинхронный (разрешение, первое окно iOS, старт движка), и
 * палец часто отпускают раньше, чем запись реально началась — это тоже
 * короткое нажатие: запись не отменяем, а фиксируем. Чистая логика без React —
 * её держат тесты.
 */
export interface PushToTalkDeps {
  /** Начать запись; true — запись действительно идёт. */
  start: () => Promise<boolean>;
  /** Остановить и обработать сказанное. */
  stop: () => Promise<void>;
  /** Остановить без обработки. */
  cancel: () => Promise<void>;
  isRecording: () => boolean;
  now: () => number;
  /** Короче — короткое нажатие: запись фиксируется, а не отправляется. */
  minHoldMs: number;
  /** Запись зафиксирована / снята с фиксации — показать «отправить» и «отмена». */
  onLockChange?: (locked: boolean) => void;
}

export interface PushToTalk {
  pressIn: () => Promise<void>;
  pressOut: () => Promise<void>;
  /** «Отправить» у зафиксированной записи. */
  send: () => Promise<void>;
  /** «Отмена»: остановить без отправки. */
  cancel: () => Promise<void>;
  /** Запись закончилась сама — снять фиксацию, запись не трогать. */
  unlock: () => void;
  isLocked: () => boolean;
}

export function createPushToTalk(d: PushToTalkDeps): PushToTalk {
  let starting = false;
  let released = false;
  let startedAt = 0;
  let locked = false;
  /** Нажали кнопку, когда запись уже зафиксирована: на отпускании — отправить. */
  let sendOnRelease = false;

  const setLocked = (v: boolean) => {
    if (locked === v) return;
    locked = v;
    d.onLockChange?.(v);
  };

  return {
    async pressIn() {
      // Запись сама закончилась (сбой распознавания) — фиксация больше не действует.
      if (locked && !d.isRecording()) setLocked(false);
      if (locked) {
        sendOnRelease = true;
        return;
      }
      if (starting || d.isRecording()) return;
      starting = true;
      released = false;
      let started = false;
      try {
        started = await d.start();
      } finally {
        starting = false;
      }
      if (!started) return;
      startedAt = d.now();
      if (released) {
        // Отпустили, пока запись запускалась, — это короткое нажатие: пишем дальше.
        released = false;
        setLocked(true);
      }
    },
    async pressOut() {
      if (starting) {
        released = true;
        return;
      }
      if (sendOnRelease) {
        sendOnRelease = false;
        setLocked(false);
        if (d.isRecording()) await d.stop();
        return;
      }
      if (!d.isRecording()) {
        setLocked(false);
        return;
      }
      if (locked) return;
      if (d.now() - startedAt < d.minHoldMs) {
        setLocked(true);
        return;
      }
      await d.stop();
    },
    async send() {
      sendOnRelease = false;
      setLocked(false);
      if (d.isRecording()) await d.stop();
    },
    async cancel() {
      sendOnRelease = false;
      setLocked(false);
      if (d.isRecording()) await d.cancel();
    },
    unlock() {
      sendOnRelease = false;
      setLocked(false);
    },
    isLocked: () => locked,
  };
}
