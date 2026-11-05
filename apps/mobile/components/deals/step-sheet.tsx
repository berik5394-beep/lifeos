import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Input } from '@/components/ui';
import { FormSheet } from '@/components/deals/form-sheet';
import { StageButton } from '@/components/deals/stage-button';
import { useColors } from '@/hooks/use-colors';
import { fontSize, spacing } from '@/constants';
import { civilOf, type Deal } from '@/services/deals';
import { stepDateChoices } from '@/services/deals-view';
import { useSaveGuard } from '@/hooks/use-save-guard';
import { dealErrorText } from '@/hooks/use-deal-income';
import { useDealStore } from '@/stores/deal-store';

/**
 * «Изменить шаг» в карточке: когда (быстрые даты по часам устройства — без нативного
 * календаря) и что сделать. Пустой текст — сервер оставит прежний («следующий шаг»).
 */
export const StepSheet = memo(function StepSheet({ deal, onClose }: { deal: Deal | null; onClose: () => void }) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const visible = deal != null;
  const update = useDealStore((s) => s.update);
  const { saving, guard } = useSaveGuard(visible);
  const [date, setDate] = useState<string | null>(null);
  const [text, setText] = useState('');

  const dealId = deal?.id ?? null;
  // Даты считаем при открытии: «сегодня» — на момент, когда открыли форму.
  const choices = useMemo(() => (dealId ? stepDateChoices() : []), [dealId]);
  useEffect(() => {
    if (!deal) return;
    const current = civilOf(deal.nextStepAt);
    setDate(choices.some((ch) => ch.date === current) ? current : null);
    setText(deal.nextStepText ?? '');
    // Только при открытии: фоновое обновление сделки не стирает то, что набирают.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, choices]);

  const pick = useCallback((d: string | undefined) => setDate(d ?? null), []);

  const onSave = useCallback(() => {
    if (!dealId || !date) return;
    const what = text.trim();
    void guard(async () => {
      try {
        await update(dealId, { nextStepDate: date, ...(what ? { nextStepText: what } : {}) });
        onClose();
      } catch (err) {
        Alert.alert('Не получилось', dealErrorText(err));
      }
    });
  }, [dealId, date, text, guard, update, onClose]);

  return (
    <FormSheet visible={visible} title="Следующий шаг" saveLabel="Сохранить" canSave={date != null} saving={saving} onSave={onSave} onClose={onClose}>
      <Text style={styles.label}>Когда</Text>
      {[choices.slice(0, 2), choices.slice(2)].map((pair) => (
        <View key={pair[0]?.label ?? 'none'} style={styles.row}>
          {pair.map((ch) => (
            <StageButton
              key={ch.date}
              label={ch.label}
              value={ch.date}
              tone={ch.date === date ? 'primary' : 'plain'}
              disabled={saving}
              onPress={pick}
            />
          ))}
        </View>
      ))}
      <Input
        label="Что сделать"
        placeholder="позвонить, отправить КП…"
        value={text}
        onChangeText={setText}
        maxLength={200}
        returnKeyType="done"
      />
    </FormSheet>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    label: { color: c.text, fontSize: fontSize.sm, fontWeight: '500' },
    row: { flexDirection: 'row', gap: spacing.sm },
  });
}
