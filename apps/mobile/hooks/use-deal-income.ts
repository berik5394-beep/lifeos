import { useCallback } from 'react';
import { Alert } from 'react-native';
import { ApiError } from '@/services/api';
import { fmtMoneyExact, type Deal } from '@/services/deals';
import { dealHead, incomeOfferText } from '@/services/deals-view';
import { useDealStore, type IncomeResult } from '@/stores/deal-store';

type RecordFn = (id: string, force?: boolean) => Promise<IncomeResult>;
export type AlertFn = typeof Alert.alert;

export function dealErrorText(err: unknown): string {
  return err instanceof ApiError && err.message ? err.message : 'Проверь интернет и попробуй ещё раз.';
}

/** done ровно один раз: кнопка и onDismiss (Android) могут прийти оба. */
function once(fn: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    fn();
  };
}

/**
 * Пишем доход; 409 (похожий доход уже есть) → переспрос «Записать ещё раз» с force.
 * done — ровно один раз в конце любой ветки. alert подменяется в тестах.
 */
export function runIncomeRecord(record: RecordFn, deal: Deal, force: boolean, done: () => void, alert: AlertFn = Alert.alert): void {
  run(record, deal, force, once(done), alert);
}

function run(record: RecordFn, deal: Deal, force: boolean, done: () => void, alert: AlertFn): void {
  record(deal.id, force)
    .then((r) => {
      if (r.kind === 'duplicate') {
        alert(
          'Уже есть такой доход',
          r.message,
          [
            { text: 'Отмена', style: 'cancel', onPress: done },
            { text: 'Записать ещё раз', onPress: () => run(record, deal, true, done, alert) },
          ],
          { cancelable: true, onDismiss: done },
        );
        return;
      }
      const text =
        r.kind === 'refused'
          ? r.message
          : r.already
            ? 'Доход по этой сделке уже был записан.'
            : `Доход записан: ${fmtMoneyExact(r.amount)}.`;
      alert(r.kind === 'refused' ? 'Не записал' : 'Готово', text, [{ text: 'OK', onPress: done }], {
        cancelable: true,
        onDismiss: done,
      });
    })
    .catch((err: unknown) => {
      alert('Не получилось', dealErrorText(err), [{ text: 'OK', onPress: done }], { cancelable: true, onDismiss: done });
    });
}

/**
 * Доход по выигранной сделке из панели: предложить («Записать доход N ₸?») или записать
 * сразу (кнопка в карточке). Сумма — точная, как в подтверждении у робота.
 */
export function useDealIncome(): {
  offer: (deal: Deal, done: () => void) => void;
  record: (deal: Deal, done: () => void) => void;
} {
  const recordIncome = useDealStore((s) => s.recordIncome);
  const record = useCallback((deal: Deal, done: () => void) => runIncomeRecord(recordIncome, deal, false, done), [recordIncome]);
  const offer = useCallback(
    (deal: Deal, done: () => void) => {
      const finish = once(done);
      Alert.alert(
        'Сделка выиграна!',
        `${dealHead(deal)}\n${incomeOfferText(deal)}`,
        [
          { text: 'Не сейчас', style: 'cancel', onPress: finish },
          { text: 'Записать', onPress: () => runIncomeRecord(recordIncome, deal, false, finish) },
        ],
        { cancelable: true, onDismiss: finish },
      );
    },
    [recordIncome],
  );
  return { offer, record };
}
