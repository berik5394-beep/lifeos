import React, { memo, useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Input } from '@/components/ui';
import { FormSheet } from '@/components/deals/form-sheet';
import { parseMoneyInput } from '@/services/deals-view';
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
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setAmount(current != null ? String(Math.round(current)) : '');
  }, [visible, current]);

  const parsed = parseMoneyInput(amount);
  const value = parsed.ok ? parsed.value : null;

  const onSave = useCallback(async () => {
    if (value == null) return;
    setSaving(true);
    try {
      await setPlan(value);
      onClose();
    } catch (err) {
      Alert.alert('Не получилось', dealErrorText(err));
    } finally {
      setSaving(false);
    }
  }, [value, setPlan, onClose]);

  return (
    <FormSheet
      visible={visible}
      title="План продаж на месяц"
      saveLabel="Сохранить"
      canSave={value != null}
      saving={saving}
      onSave={() => void onSave()}
      onClose={onClose}
    >
      <Input
        label="Сумма, ₸"
        placeholder="10 000 000"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        autoFocus
        error={parsed.ok ? undefined : 'Сумма — число, например 10 000 000'}
      />
    </FormSheet>
  );
});
