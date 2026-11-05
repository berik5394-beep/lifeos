import React, { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { borderRadius, fontSize, spacing } from '@/constants';

export type StageButtonTone = 'plain' | 'success' | 'danger' | 'primary';

/**
 * Кнопка в карточке сделки: соседняя стадия, «Выиграна», «Проиграна», «Записать доход».
 * value уходит в onPress — один стабильный обработчик на список кнопок (не ломает memo).
 */
export const StageButton = memo(function StageButton({
  label,
  onPress,
  value,
  tone = 'plain',
  disabled = false,
}: {
  label: string;
  onPress: (value: string | undefined) => void;
  value?: string;
  tone?: StageButtonTone;
  disabled?: boolean;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const press = useCallback(() => onPress(value), [onPress, value]);
  return (
    <Pressable
      onPress={press}
      disabled={disabled}
      style={[styles.btn, styles[tone], disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text style={tone === 'plain' ? styles.textPlain : styles.text} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    btn: { flex: 1, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm, borderRadius: borderRadius.md, alignItems: 'center' },
    plain: { backgroundColor: c.surface },
    success: { backgroundColor: c.success },
    danger: { backgroundColor: c.danger },
    primary: { backgroundColor: c.primary },
    disabled: { opacity: 0.5 },
    text: { color: '#FFFFFF', fontSize: fontSize.sm, fontWeight: '600' },
    textPlain: { color: c.text, fontSize: fontSize.sm, fontWeight: '600' },
  });
}
