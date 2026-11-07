import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';

/**
 * «Всё на экране нажимается» (Berik): тап по строке (источник дохода,
 * категория трат, день, цель) открывает поле прямо под ней — записал и
 * готово, без перехода в отдельное место. Как TapToAdd: текст стирается
 * только после успешной записи, ошибка видна под полем, двойной «Готово» —
 * без дубля. Пустое «Готово» или уход с поля — свернуть.
 */
export const InlineEntry = memo(function InlineEntry({
  children,
  placeholder,
  onSubmit,
  keyboardType,
  accessibilityLabel,
  style,
}: {
  /** Сама строка (как была). */
  children: React.ReactNode;
  placeholder: string;
  /** Не записалось — бросить ошибку с понятным текстом. */
  onSubmit: (text: string) => void | Promise<unknown>;
  keyboardType?: KeyboardTypeOptions;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const submit = useCallback(async () => {
    const t = text.trim();
    if (!t) {
      setOpen(false);
      return;
    }
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(t);
      setText('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Не сохранилось. Попробуй ещё раз.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [text, onSubmit]);

  return (
    <View style={style}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => pressed && styles.pressed}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </Pressable>
      {open ? (
        <View>
          <TextInput
            style={[styles.input, saving && styles.saving]}
            value={text}
            onChangeText={(v) => {
              setText(v);
              if (error) setError(null);
            }}
            placeholder={placeholder}
            placeholderTextColor={c.textSecondary}
            autoFocus
            editable={!saving}
            keyboardType={keyboardType}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            onBlur={() => {
              if (!text.trim()) setOpen(false);
            }}
            accessibilityLabel={placeholder}
          />
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    pressed: { opacity: 0.6 },
    input: {
      color: c.text,
      fontSize: fontSize.md,
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      minHeight: 44,
      marginVertical: spacing.xs,
    },
    saving: { opacity: 0.6 },
    error: { color: c.danger, fontSize: fontSize.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  });
}
