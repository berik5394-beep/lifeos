import { useCallback } from 'react';
import { Alert } from 'react-native';
import { ApiError } from '@/services/api';
import { fmtMoneyExact, type Deal } from '@/services/deals';
import { dealHead, incomeOfferText } from '@/services/deals-view';
import { useDealStore, type IncomeResult } from '@/stores/deal-store';

type RecordFn = (id: string, force?: boolean) => Promise<IncomeResult>;

export function dealErrorText(err: unknown): string {
  return err instanceof ApiError && err.message ? err.message : 'Проверь интернет и попробуй ещё раз.';
}

/** Пишем доход; 409 (похожий доход уже есть) → переспрос «Записать ещё раз» с force. done — в конце любой ветки. */
function runRecord(record: RecordFn, deal: Deal, force: boolean, done: () => void): void {
  record(deal.id, force)
    .then((r) => {
      if (r.kind === 'duplicate') {
        Alert.alert(
          'Похоже, уже записан',
          r.message,
          [
            { text: 'Отмена', style: 'cancel', onPress: done },
            { text: 'Записать ещё раз', onPress: () => runRecord(record, deal, true, done) },
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
      Alert.alert(r.kind === 'refused' ? 'Не записал' : 'Готово', text, [{ text: 'OK', onPress: done }], {
        cancelable: true,
        onDismiss: done,
      });
    })
    .catch((err: unknown) => {
      Alert.alert('Не получилось', dealErrorText(err), [{ text: 'OK', onPress: done }], { cancelable: true, onDismiss: done });
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
  const record = useCallback((deal: Deal, done: () => void) => runRecord(recordIncome, deal, false, done), [recordIncome]);
  const offer = useCallback(
    (deal: Deal, done: () => void) => {
      Alert.alert(
        'Сделка выиграна!',
        `${dealHead(deal)}\n${incomeOfferText(deal)}`,
        [
          { text: 'Не сейчас', style: 'cancel', onPress: done },
          { text: 'Записать', onPress: () => runRecord(recordIncome, deal, false, done) },
        ],
        { cancelable: true, onDismiss: done },
      );
    },
    [recordIncome],
  );
  return { offer, record };
}
