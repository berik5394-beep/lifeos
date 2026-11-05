import React, { memo, useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Input } from '@/components/ui';
import { FormSheet } from '@/components/deals/form-sheet';
import { useMoneyField } from '@/hooks/use-money-field';
import { dealErrorText } from '@/hooks/use-deal-income';
import { useDealStore } from '@/stores/deal-store';

/** «+» — сделка руками: клиент (обязательно), что продаём и сумма (по желанию). */
export const NewDealSheet = memo(function NewDealSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const create = useDealStore((s) => s.create);
  const [personName, setPersonName] = useState('');
  const [title, setTitle] = useState('');
  const amount = useMoneyField();
  const { parsed, validate, reset: resetAmount } = amount;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPersonName('');
    setTitle('');
    resetAmount('');
  }, [visible, resetAmount]);

  const canSave = personName.trim().length > 0;

  const onSave = useCallback(async () => {
    // Ошибку суммы показываем по «Добавить», а не пока печатают.
    if (!canSave || !validate() || !parsed.ok) return;
    setSaving(true);
    try {
      await create({ personName, title, amount: parsed.value });
      onClose();
    } catch (err) {
      Alert.alert('Не получилось', dealErrorText(err));
    } finally {
      setSaving(false);
    }
  }, [canSave, validate, parsed, create, personName, title, onClose]);

  return (
    <FormSheet
      visible={visible}
      title="Новая сделка"
      saveLabel="Добавить"
      canSave={canSave}
      saving={saving}
      onSave={() => void onSave()}
      onClose={onClose}
    >
      <Input
        label="Клиент"
        placeholder="Ахмет"
        value={personName}
        onChangeText={setPersonName}
        autoFocus
        maxLength={120}
        returnKeyType="next"
      />
      <Input label="Что продаём" placeholder="оборудование" value={title} onChangeText={setTitle} maxLength={200} />
      <Input
        label="Сумма, ₸"
        placeholder="2 000 000"
        value={amount.text}
        onChangeText={amount.setText}
        onBlur={amount.onBlur}
        keyboardType="numeric"
        error={amount.error}
      />
    </FormSheet>
  );
});
