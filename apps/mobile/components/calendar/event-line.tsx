import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SwipeableRow } from '@/components/ui';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { parseEventLine } from './calendar-logic';

export interface EventLineData {
  id: string;
  title: string;
  startTime: string | null;
  endTime?: string | null;
}

/** «14:00–15:00 встреча с Ахметом» — то, что видно и что правится. */
export function eventLineText(e: EventLineData): string {
  const time = e.startTime ? `${e.startTime}${e.endTime ? `–${e.endTime}` : ''} ` : '';
  return `${time}${e.title}`;
}

/**
 * Встреча в окне дня. Раньше её нельзя было ни перенести, ни удалить с экрана.
 * Тап — строка правки (время и название, как при добавлении: «16:00 встреча»);
 * сдвиг — удалить (минус). Без плюсиков и форм (как задачи).
 */
export const EventLine = memo(function EventLine({
  event,
  onEdit,
  onDelete,
}: {
  event: EventLineData;
  onEdit: (event: EventLineData, next: { title: string; startTime?: string; endTime?: string }) => Promise<unknown>;
  onDelete: (event: EventLineData) => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const submit = useCallback(async () => {
    const t = text.trim();
    if (!t || t === eventLineText(event)) {
      setEditing(false);
      return;
    }
    const p = parseEventLine(t);
    if (!p) {
      setError('Напиши время и что за встреча: «16:00 встреча с Ахметом».');
      return;
    }
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await onEdit(event, p);
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Не сохранилось. Попробуй ещё раз.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [text, event, onEdit]);

  if (editing) {
    return (
      <View>
        <TextInput
          style={[styles.row, styles.input, saving && styles.saving]}
          value={text}
          onChangeText={(v) => {
            setText(v);
            if (error) setError(null);
          }}
          autoFocus
          editable={!saving}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          onBlur={() => void submit()}
          accessibilityLabel="Изменить встречу: время и название"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }
  return (
    <SwipeableRow onDelete={() => onDelete(event)} deleteLabel="Удалить встречу">
      <Pressable
        style={({ pressed }) => [styles.row, { backgroundColor: c.surface }, pressed && styles.pressed]}
        onPress={() => {
          setText(eventLineText(event));
          setEditing(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${eventLineText(event)}: нажми, чтобы перенести или переименовать`}
      >
        <Text style={styles.text}>
          {event.startTime ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ''} · ` : ''}
          {event.title}
        </Text>
      </Pressable>
    </SwipeableRow>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    row: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
      marginBottom: spacing.xs,
    },
    pressed: { opacity: 0.7 },
    text: { color: c.text, fontSize: fontSize.md },
    input: { color: c.text, fontSize: fontSize.md, backgroundColor: c.surface },
    saving: { opacity: 0.6 },
    error: { color: c.danger, fontSize: fontSize.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  });
}
