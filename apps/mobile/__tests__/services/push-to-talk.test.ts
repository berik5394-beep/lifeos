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
    onTooShort: () => calls.push('hint'),
    ...over,
  };
  const ptt = createPushToTalk(deps);
  return { ptt, calls, tick: (ms: number) => (t += ms), finishStart: (ok = true) => resolveStart(ok), isRec: () => recording };
}

describe('голос «держи и говори»', () => {
  it('держал и отпустил — запись остановлена и отправлена', async () => {
    const s = setup();
    const p = s.ptt.pressIn();
    s.finishStart();
    await p;
    s.tick(2000);
    await s.ptt.pressOut();
    expect(s.calls).toEqual(['start', 'stop']);
  });

  it('отпустил, пока запись ещё запускалась (окно разрешения) — не висим: отмена + подсказка', async () => {
    const s = setup();
    const p = s.ptt.pressIn();
    await s.ptt.pressOut(); // палец отпущен до старта
    s.finishStart();
    await p;
    expect(s.calls).toEqual(['start', 'cancel', 'hint']);
    expect(s.isRec()).toBe(false);
  });

  it('после такой отмены микрофон снова работает (раньше висел навсегда)', async () => {
    const s = setup();
    const p1 = s.ptt.pressIn();
    await s.ptt.pressOut();
    s.finishStart();
    await p1;
    const p2 = s.ptt.pressIn();
    s.finishStart();
    await p2;
    s.tick(1500);
    await s.ptt.pressOut();
    expect(s.calls).toEqual(['start', 'cancel', 'hint', 'start', 'stop']);
  });

  it('случайное касание короче порога — отмена и подсказка, без отправки', async () => {
    const s = setup();
    const p = s.ptt.pressIn();
    s.finishStart();
    await p;
    s.tick(100);
    await s.ptt.pressOut();
    expect(s.calls).toEqual(['start', 'cancel', 'hint']);
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
