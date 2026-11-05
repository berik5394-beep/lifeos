/**
 * Голос «держи и говори»: нажал — пишем, отпустил — отправляем.
 *
 * Запуск записи асинхронный (разрешение, первое окно iOS, старт движка), и
 * палец часто отпускают раньше, чем запись реально началась. Раньше этот
 * «отпустил» терялся: запись висла, и микрофон больше не реагировал. Здесь
 * чистая логика без React — её держат тесты.
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
  /** Короче — случайное касание, а не фраза. */
  minHoldMs: number;
  /** Отпустил слишком рано — подсказать держать кнопку. */
  onTooShort: () => void;
}

export interface PushToTalk {
  pressIn: () => Promise<void>;
  pressOut: () => Promise<void>;
}

export function createPushToTalk(d: PushToTalkDeps): PushToTalk {
  let starting = false;
  let released = false;
  let startedAt = 0;

  return {
    async pressIn() {
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
        // Отпустили, пока запись запускалась: ничего не записано — отменяем и подсказываем.
        released = false;
        await d.cancel();
        d.onTooShort();
      }
    },
    async pressOut() {
      if (starting) {
        released = true;
        return;
      }
      if (!d.isRecording()) return;
      if (d.now() - startedAt < d.minHoldMs) {
        await d.cancel();
        d.onTooShort();
        return;
      }
      await d.stop();
    },
  };
}
