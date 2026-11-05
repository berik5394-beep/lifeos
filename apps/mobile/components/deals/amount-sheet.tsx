import React, { memo, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { Input } from '@/components/ui';
import { FormSheet } from '@/components/deals/form-sheet';
import type { Deal } from '@/services/deals';
import { fmtAmountInput } from '@/services/deals-view';
import { useMoneyField } from '@/hooks/use-money-field';
import { useSaveGuard } from '@/hooks/use-save-guard';
import { dealErrorText } from '@/hooks/use-deal-income';
import { useDealStore } from '@/stores/deal-store';

/**
 * «Изменить сумму» в карточке сделки (PUT /deals/:id { amount }). Пусто — «сумма не названа».
 * Форму закрывает родитель в onSaved: у выигранной сделки сервер может предложить записать доход,
 * и вопрос должен показаться поверх открытой формы (Alert поверх закрывающейся модалки на iOS теряется).
 */
export const AmountSheet = memo(function AmountSheet({
  deal,
  onClose,
  onSaved,
}: {
  /** null — форма закрыта. */
  deal: Deal | null;
  onClose: () => void;
  onSaved: (r: { deal: Deal; incomeOffer: boolean }) => void;
}) {
  const visible = deal != null;
  const update = useDealStore((s) => s.update);
  const amount = useMoneyField();
  const { parsed, validate, reset: resetAmount } = amount;
  const { saving, guard } = useSaveGuard(visible);

  const dealId = deal?.id ?? null;
  const current = deal?.amount ?? null;
  useEffect(() => {
    // Только при открытии: фоновое обновление сделки не стирает то, что набирают.
    if (dealId) resetAmount(fmtAmountInput(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, resetAmount]);

  const onSave = useCallback(() => {
    if (!dealId || !validate() || !parsed.ok) return;
    const value = parsed.value;
    void guard(async () => {
      try {
        onSaved(await update(dealId, { amount: value }));
      } catch (err) {
        Alert.alert('Не получилось', dealErrorText(err));
      }
    });
  }, [dealId, validate, parsed, guard, update, onSaved]);

  return (
    <FormSheet visible={visible} title="Сумма сделки" saveLabel="Сохранить" canSave saving={saving} onSave={onSave} onClose={onClose}>
      <Input
        label="Сумма, ₸"
        placeholder="2 000 000 (пусто — не названа)"
        value={amount.text}
        onChangeText={amount.setText}
        onBlur={amount.onBlur}
        keyboardType="numeric"
        autoFocus
        error={amount.error}
      />
    </FormSheet>
  );
});
