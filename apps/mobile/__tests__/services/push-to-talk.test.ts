import { createPushToTalk, type PushToTalkDeps } from '@/services/push-to-talk';

function setup(over: Partial<PushToTalkDeps> = {}) {
  let recording = false;
  let t = 0;
  let resolveStart: (ok: boolean) => void = () => {};
  const calls: string[] = [];
  const deps: PushToTalkDeps = {
    start: () =>
      new Promise<boolean>((r) => {
        calls.push('start');
        resolveStart = (ok) => {
          recording = ok;
          r(ok);
        };
      }),
    stop: async () => {
      calls.push('stop');
      recording = false;
    },
    cancel: async () => {
      calls.push('cancel');
      recording = false;
    },
    isRecording: () => recording,
    now: () => t,
    minHoldMs: 350,
    onLockChange: (v) => calls.push(v ? 'lock' : 'unlock'),
    ...over,
  };
  const ptt = createPushToTalk(deps);
  return {
    ptt,
    calls,
    tick: (ms: number) => (t += ms),
    finishStart: (ok = true) => resolveStart(ok),
    isRec: () => recording,
    endRecording: () => (recording = false),
  };
}

async function tapToLock(s: ReturnType<typeof setup>) {
  const p = s.ptt.pressIn();
  s.finishStart();
  await p;
  s.tick(100);
  await s.ptt.pressOut();
}

describe('кнопка голоса: удержание', () => {
  it('держал и отпустил — запись остановлена и отправлена', async () => {
    const s = setup();
    const p = s.ptt.pressIn();
    s.finishStart();
    await p;
    s.tick(2000);
    await s.ptt.pressOut();
    expect(s.calls).toEqual(['start', 'stop']);
  });

  it('запись не стартовала (нет разрешения) — отпускание ничего не делает', async () => {
    const s = setup();
    const p = s.ptt.pressIn();
    s.finishStart(false);
    await p;
    await s.ptt.pressOut();
    expect(s.calls).toEqual(['start']);
  });

  it('повторное нажатие во время запуска не запускает вторую запись', async () => {
    const s = setup();
    const p = s.ptt.pressIn();
    await s.ptt.pressIn();
    s.finishStart();
    await p;
    expect(s.calls.filter((c) => c === 'start')).toHaveLength(1);
  });
});

describe('кнопка голоса: нажал — говоришь — отправил (как в WhatsApp)', () => {
  it('короткое нажатие — запись не отменяется, а фиксируется', async () => {
    const s = setup();
    await tapToLock(s);
    expect(s.calls).toEqual(['start', 'lock']);
    expect(s.isRec()).toBe(true);
    expect(s.ptt.isLocked()).toBe(true);
  });

  it('отпустил ещё до старта записи (окно разрешения) — тоже фиксация, не отмена', async () => {
    const s = setup();
    const p = s.ptt.pressIn();
    await s.ptt.pressOut();
    s.finishStart();
    await p;
    expect(s.calls).toEqual(['start', 'lock']);
    expect(s.isRec()).toBe(true);
  });

  it('«отправить» — фраза уходит', async () => {
    const s = setup();
    await tapToLock(s);
    s.tick(5000);
    await s.ptt.send();
    expect(s.calls).toEqual(['start', 'lock', 'unlock', 'stop']);
    expect(s.ptt.isLocked()).toBe(false);
  });

  it('ещё раз на кнопку — тоже отправить', async () => {
    const s = setup();
    await tapToLock(s);
    s.tick(4000);
    await s.ptt.pressIn();
    await s.ptt.pressOut();
    expect(s.calls).toEqual(['start', 'lock', 'unlock', 'stop']);
  });

  it('«отмена» — без отправки', async () => {
    const s = setup();
    await tapToLock(s);
    await s.ptt.cancel();
    expect(s.calls).toEqual(['start', 'lock', 'unlock', 'cancel']);
    expect(s.isRec()).toBe(false);
  });

  it('запись сама оборвалась — следующее нажатие начинает новую, а не «отправляет» пустоту', async () => {
    const s = setup();
    await tapToLock(s);
    s.endRecording();
    const p = s.ptt.pressIn();
    s.finishStart();
    await p;
    s.tick(1500);
    await s.ptt.pressOut();
    expect(s.calls).toEqual(['start', 'lock', 'unlock', 'start', 'stop']);
  });
});

describe('кнопка голоса: снять фиксацию', () => {
  it('unlock не отменяет и не отправляет запись', async () => {
    const s = setup();
    await tapToLock(s);
    s.ptt.unlock();
    expect(s.calls).toEqual(['start', 'lock', 'unlock']);
    expect(s.isRec()).toBe(true);
  });
});
