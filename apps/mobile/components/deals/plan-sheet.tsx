import React, { memo, useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Input } from '@/components/ui';
import { FormSheet } from '@/components/deals/form-sheet';
import { useMoneyField } from '@/hooks/use-money-field';
import { dealErrorText } from '@/hooks/use-deal-income';
import { useDealStore } from '@/stores/deal-store';

/** План продаж на текущий месяц (PUT /sales-plan). */
export const PlanSheet = memo(function PlanSheet({
  visible,
  current,
  onClose,
}: {
  visible: boolean;
  current: number | null;
  onClose: () => void;
}) {
  const setPlan = useDealStore((s) => s.setPlan);
  const amount = useMoneyField();
  const { parsed, validate, reset: resetAmount } = amount;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) resetAmount(current != null ? String(Math.round(current)) : '');
  }, [visible, current, resetAmount]);

  const value = parsed.ok ? parsed.value : null;

  const onSave = useCallback(async () => {
    if (!validate() || value == null) return;
    setSaving(true);
    try {
      await setPlan(value);
      onClose();
    } catch (err) {
      Alert.alert('Не получилось', dealErrorText(err));
    } finally {
      setSaving(false);
    }
  }, [validate, value, setPlan, onClose]);

  return (
    <FormSheet
      visible={visible}
      title="План продаж на месяц"
      saveLabel="Сохранить"
      canSave={amount.text.trim().length > 0}
      saving={saving}
      onSave={() => void onSave()}
      onClose={onClose}
    >
      <Input
        label="Сумма, ₸"
        placeholder="10 000 000"
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
