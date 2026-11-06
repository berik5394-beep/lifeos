import React, { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';

/**
 * Добавление без плюсиков (Berik): в конце списка — бледная пустая строка
 * («Новая задача»). Тап по ней — сразу поле ввода; «Готово» добавляет и
 * оставляет поле открытым для следующей записи, пустое — сворачивается.
 * Если вместо строки нужна форма (сумма, категория) — onPress открывает её.
 */
export const TapToAdd = memo(function TapToAdd({
  hint,
  onSubmit,
  onPress,
}: {
  /** Бледная подпись пустой строки: «Новая задача», «Новая цель». */
  hint: string;
  /** Короткая запись прямо в строке. */
  onSubmit?: (text: string) => void | Promise<unknown>;
  /** Вместо строки — открыть свою форму. */
  onPress?: () => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const submit = useCallback(() => {
    const t = text.trim();
    if (!t) {
      setEditing(false);
      return;
    }
    setText('');
    void Promise.resolve(onSubmit?.(t)).catch(() => {});
  }, [text, onSubmit]);

  if (editing && onSubmit) {
    return (
      <TextInput
        style={[styles.row, styles.input]}
        value={text}
        onChangeText={setText}
        placeholder={hint}
        placeholderTextColor={c.textSecondary}
        autoFocus
        returnKeyType="done"
        blurOnSubmit={false}
        onSubmitEditing={submit}
        onBlur={() => {
          if (!text.trim()) setEditing(false);
        }}
        accessibilityLabel={hint}
      />
    );
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={() => (onPress ? onPress() : setEditing(true))}
      accessibilityRole="button"
      accessibilityLabel={`${hint}: нажми, чтобы добавить`}
    >
      <Text style={styles.hint}>{hint}</Text>
    </Pressable>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    row: {
      minHeight: 52,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
    },
    pressed: { backgroundColor: c.surface },
    hint: { color: c.textSecondary, fontSize: fontSize.md, opacity: 0.55 },
    input: { color: c.text, fontSize: fontSize.md, backgroundColor: c.surface },
  });
}
