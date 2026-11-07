import { startRobotNudges } from '@/services/robot-nudges';
import { useChatStore } from '@/stores/chat-store';

function setup(nudges: Array<{ id: string; message: string } | null>) {
  let listener: (s: string) => void = () => {};
  const appState = { addEventListener: jest.fn((_e: string, cb: (s: string) => void) => { listener = cb; return { remove: jest.fn() }; }) };
  const get = jest.fn(async () => ({ nudge: nudges.shift() ?? null }));
  const show = jest.fn();
  let t = 0;
  const flush = () => new Promise((r) => setImmediate(r));
  return { appState, get, show, now: () => t, tick: (ms: number) => { t += ms; }, emit: (s: string) => listener(s), flush };
}

describe('нуджи робота в приложении', () => {
  it('при открытии показывает нудж облачком; при возврате — не чаще раза в 10 минут', async () => {
    const h = setup([{ id: 'n1', message: 'Задача «сайт» висит 4 дня' }, { id: 'n2', message: 'второй' }]);
    startRobotNudges('tok', h as never);
    await h.flush();
    expect(h.show).toHaveBeenCalledWith('n1', 'Задача «сайт» висит 4 дня');
    h.emit('active');
    await h.flush();
    expect(h.get).toHaveBeenCalledTimes(1);
    h.tick(11 * 60 * 1000);
    h.emit('active');
    await h.flush();
    expect(h.show).toHaveBeenLastCalledWith('n2', 'второй');
  });

  it('сказать нечего или нет сети — молчит', async () => {
    const h = setup([null]);
    h.get.mockRejectedValueOnce(new Error('offline'));
    startRobotNudges('tok', h as never);
    await h.flush();
    expect(h.show).not.toHaveBeenCalled();
  });
});

describe('showNudge в чат-сторе', () => {
  it('нудж — реплика робота; повтор того же нуджа не дублируется', () => {
    useChatStore.setState({ messages: [] });
    useChatStore.getState().showNudge('n1', 'Привет, заметил кое-что');
    useChatStore.getState().showNudge('n1', 'Привет, заметил кое-что');
    const m = useChatStore.getState().messages;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ id: 'nudge-n1', role: 'assistant', content: 'Привет, заметил кое-что' });
  });
});
