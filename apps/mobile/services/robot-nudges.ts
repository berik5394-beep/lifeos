import { AppState, type AppStateStatus } from 'react-native';
import { api } from '@/services/api';
import { useChatStore } from '@/stores/chat-store';

/** Не дёргать сервер чаще (возвраты в приложение бывают каждую минуту). */
const CHECK_EVERY_MS = 10 * 60 * 1000;

type Deps = {
  get: (path: string) => Promise<{ nudge: { id: string; message: string } | null }>;
  show: (id: string, message: string) => void;
  appState: Pick<typeof AppState, 'addEventListener'>;
  now: () => number;
};

/**
 * Нуджи робота в приложении. Раньше всё, что мозг замечал сам (зависшая
 * задача, цель буксует, три дня тяжело по дневнику), доходило максимум одним
 * пушем в день, а в самом приложении не показывалось. Теперь при открытии и
 * возврате в приложение робот говорит один нудж облачком (сервер — ≤3 в день,
 * и тот же нудж пушем уже не придёт). Ответ «да» мозг поймёт: нудж в истории.
 */
export function startRobotNudges(token: string, deps: Partial<Deps> = {}): () => void {
  const get = deps.get ?? ((path: string) => api.get<{ nudge: { id: string; message: string } | null }>(path, token));
  const show = deps.show ?? ((id: string, message: string) => useChatStore.getState().showNudge(id, message));
  const appState = deps.appState ?? AppState;
  const now = deps.now ?? Date.now;
  let last = Number.NEGATIVE_INFINITY; // первая проверка — сразу
  let busy = false;

  const check = async () => {
    if (busy || now() - last < CHECK_EVERY_MS) return;
    busy = true;
    last = now();
    try {
      const { nudge } = await get('/nudges/next');
      if (nudge) show(nudge.id, nudge.message);
    } catch {
      /* нет сети / старый сервер — молчим, попробуем при следующем возврате */
    } finally {
      busy = false;
    }
  };

  void check();
  const sub = appState.addEventListener('change', (s: AppStateStatus) => {
    if (s === 'active') void check();
  });
  return () => sub.remove();
}
