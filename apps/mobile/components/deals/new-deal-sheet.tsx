import React, { memo, useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Input } from '@/components/ui';
import { FormSheet } from '@/components/deals/form-sheet';
import { parseMoneyInput } from '@/services/deals-view';
import { dealErrorText } from '@/hooks/use-deal-income';
import { useDealStore } from '@/stores/deal-store';

/** «+» — сделка руками: клиент (обязательно), что продаём и сумма (по желанию). */
export const NewDealSheet = memo(function NewDealSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const create = useDealStore((s) => s.create);
  const [personName, setPersonName] = useState('');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPersonName('');
    setTitle('');
    setAmount('');
  }, [visible]);

  const parsed = parseMoneyInput(amount);
  const canSave = personName.trim().length > 0 && parsed.ok;

  const onSave = useCallback(async () => {
    if (!canSave || !parsed.ok) return;
    setSaving(true);
    try {
      await create({ personName, title, amount: parsed.value });
      onClose();
    } catch (err) {
      Alert.alert('Не получилось', dealErrorText(err));
    } finally {
      setSaving(false);
    }
  }, [canSave, parsed, create, personName, title, onClose]);

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
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        error={parsed.ok ? undefined : 'Сумма — число, например 2 000 000'}
      />
    </FormSheet>
  );
});
