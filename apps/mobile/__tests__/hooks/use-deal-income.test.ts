import type { AlertButton, AlertOptions } from 'react-native';
import { runIncomeRecord, type AlertFn } from '@/hooks/use-deal-income';
import type { Deal } from '@/services/deals';
import type { IncomeResult } from '@/stores/deal-store';

// Глобальный мок api (setup.ts) без ApiError — берём настоящий класс.
jest.mock('@/services/api', () => {
  const actual = jest.requireActual('@/services/api');
  return { ApiError: actual.ApiError, api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } };
});

const deal: Deal = {
  id: 'd1', personEntityId: null, personName: 'Ахмет', title: 'оборудование', amount: 2_000_000, currency: '₸',
  stage: 'won', stageChangedAt: '', nextStepAt: null, nextStepText: null, lastActivityAt: '', closedAt: null,
  lostReason: null, wonIncomeId: null, createdAt: '', updatedAt: '',
};

interface Shown {
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
}

function fakeAlert(): { alert: AlertFn; shown: Shown[] } {
  const shown: Shown[] = [];
  const alert: AlertFn = (title, message, buttons, options) => {
    shown.push({ title, message, buttons: buttons ?? [], options });
  };
  return { alert, shown };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const press = (s: Shown, text: string) => s.buttons.find((b) => b.text === text)?.onPress?.();

describe('доход по сделке — переспрос дубля и done ровно один раз', () => {
  it('409 → «Записать ещё раз» → force=true → «Готово»; done один раз, даже если onDismiss тоже сработал', async () => {
    const results: IncomeResult[] = [
      { kind: 'duplicate', message: 'Похоже, этот доход уже записан (2 000 000 ₸ от Ахмета, 05.11). Записать ещё раз?' },
      { kind: 'recorded', already: false, amount: 2_000_000 },
    ];
    const record = jest.fn(async () => results.shift() as IncomeResult);
    const done = jest.fn();
    const { alert, shown } = fakeAlert();

    runIncomeRecord(record, deal, false, done, alert);
    await flush();
    expect(record).toHaveBeenLastCalledWith('d1', false);
    expect(shown[0].title).toBe('Уже есть такой доход');
    press(shown[0], 'Записать ещё раз');
    await flush();
    expect(record).toHaveBeenLastCalledWith('d1', true);
    expect(shown[1].title).toBe('Готово');
    press(shown[1], 'OK');
    shown[1].options?.onDismiss?.();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('409 → «Отмена»: done один раз, повторной записи нет', async () => {
    const record = jest.fn(async (): Promise<IncomeResult> => ({ kind: 'duplicate', message: 'дубль' }));
    const done = jest.fn();
    const { alert, shown } = fakeAlert();
    runIncomeRecord(record, deal, false, done, alert);
    await flush();
    press(shown[0], 'Отмена');
    shown[0].options?.onDismiss?.();
    expect(record).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('сеть упала → «Не получилось», done один раз', async () => {
    const record = jest.fn(async (): Promise<IncomeResult> => {
      throw new Error('сеть');
    });
    const done = jest.fn();
    const { alert, shown } = fakeAlert();
    runIncomeRecord(record, deal, false, done, alert);
    await flush();
    expect(shown[0].title).toBe('Не получилось');
    press(shown[0], 'OK');
    press(shown[0], 'OK');
    expect(done).toHaveBeenCalledTimes(1);
  });
});
