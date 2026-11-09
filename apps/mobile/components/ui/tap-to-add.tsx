import React, { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';

/** Рамка, внутри которой строка «Новая …»: касание по рамке открывает строку. */
const AreaCtx = createContext<{ register: (activate: (() => void) | null) => void } | null>(null);

/**
 * Berik 2026-11-09: «вписать задачу — касанием в любое место рамки, а не
 * именно по надписи». Оборачивает карточку/колонку: тап по её пустому месту
 * открывает строку «Новая …» внутри (строки задач/целей — свои нажатия, они
 * срабатывают как раньше). Только там, где внутри есть TapToAdd: делать
 * нажимаемой любую карточку нельзя — она съела бы касания внешней рамки.
 */
export const TapToAddArea = memo(function TapToAddArea({
  children,
  style,
  onLayout,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const target = useRef<(() => void) | null>(null);
  const ctx = useMemo(() => ({ register: (f: (() => void) | null) => (target.current = f) }), []);
  return (
    <AreaCtx.Provider value={ctx}>
      <Pressable style={style} onLayout={onLayout} onPress={() => target.current?.()} accessible={false}>
        {children}
      </Pressable>
    </AreaCtx.Provider>
  );
});

/**
 * Добавление без плюсиков (Berik): в конце списка — бледная пустая строка
 * («Новая задача»). Тап по ней — сразу поле ввода; «Готово» добавляет и
 * оставляет поле открытым для следующей записи, пустое — сворачивается.
 * Если вместо строки нужна форма (сумма, категория) — onPress открывает её.
 *
 * Текст стирается только после успешной записи: onSubmit бросает ошибку —
 * текст остаётся, причина видна под строкой. Пока пишется — второй «Готово»
 * не шлёт дубль.
 */
export const TapToAdd = memo(function TapToAdd({
  hint,
  onSubmit,
  onPress,
}: {
  /** Бледная подпись пустой строки: «Новая задача», «Новая цель». */
  hint: string;
  /** Короткая запись прямо в строке. Не сохранилось — бросить ошибку (текст останется). */
  onSubmit?: (text: string) => void | Promise<unknown>;
  /** Вместо строки — открыть свою форму. */
  onPress?: () => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const inputRef = useRef<TextInput>(null);

  // Касание по рамке вокруг (TapToAddArea) — как касание по самой строке.
  const area = useContext(AreaCtx);
  const activate = useCallback(() => {
    if (onPress) onPress();
    else if (onSubmit) {
      if (editing) inputRef.current?.focus();
      else setEditing(true);
    }
  }, [onPress, onSubmit, editing]);
  useEffect(() => {
    if (!area) return;
    area.register(activate);
    return () => area.register(null);
  }, [area, activate]);

  const submit = useCallback(async () => {
    const t = text.trim();
    if (!t) {
      setEditing(false);
      return;
    }
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSubmit?.(t);
      setText('');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Не сохранилось. Попробуй ещё раз.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [text, onSubmit]);

  if (editing && onSubmit) {
    return (
      <View>
        <TextInput
          ref={inputRef}
          style={[styles.row, styles.input, saving && styles.saving]}
          value={text}
          onChangeText={(v) => {
            setText(v);
            if (error) setError(null);
          }}
          placeholder={hint}
          placeholderTextColor={c.textSecondary}
          autoFocus
          editable={!saving}
          returnKeyType="done"
          blurOnSubmit={false}
          onSubmitEditing={() => void submit()}
          onBlur={() => {
            if (!text.trim()) setEditing(false);
          }}
          accessibilityLabel={hint}
          accessibilityState={{ busy: saving }}
        />
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
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
    saving: { opacity: 0.6 },
    error: { color: c.danger, fontSize: fontSize.sm, paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  });
}
