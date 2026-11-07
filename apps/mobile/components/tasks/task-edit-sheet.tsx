import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Button, Input, Modal } from '@/components/ui';
import { useColors } from '@/hooks/use-colors';
import { useTaskStore } from '@/stores/task-store';
import { borderRadius, fontSize, spacing, priorities, taskCategories } from '@/constants';
import { buildUpdate, draftFromTask, quickDays, type EditableTask, type TaskDraft } from './task-edit-logic';

type Chip = { key: string; label: string; icon: string; color: string };

const PRIORITY_CHIPS: Chip[] = (Object.keys(priorities) as (keyof typeof priorities)[]).map((key) => ({ key, ...priorities[key] }));
const CATEGORY_CHIPS: Chip[] = (Object.keys(taskCategories) as (keyof typeof taskCategories)[]).map((key) => ({
  key,
  ...taskCategories[key],
}));

/**
 * Карточка задачи: тап по строке задачи открывает её (раньше — только невидимый
 * долгий тап и только в «Задачах»). Важность, день, время, категория, заметки.
 * task = null — закрыта.
 */
export const TaskEditSheet = memo(function TaskEditSheet({
  task,
  onClose,
  extra,
}: {
  task: EditableTask | null;
  onClose: () => void;
  /** Доп. блок под названием (канбан: колонка одним касанием, «Убрать»). */
  extra?: React.ReactNode;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const updateTask = useTaskStore((s) => s.updateTask);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Черновик — при открытии другой задачи; фоновое обновление стора не стирает ввод.
  const taskId = task?.id ?? null;
  useEffect(() => {
    setDraft(task ? draftFromTask(task) : null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const set = useCallback(<K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (!task || !draft || saving) return;
    const r = buildUpdate(draft);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSaving(true);
    try {
      await updateTask(task.id, r.data);
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Не сохранилось. Попробуй ещё раз.');
    } finally {
      setSaving(false);
    }
  }, [task, draft, saving, updateTask, onClose]);

  const days = useMemo(() => quickDays(), [taskId]);

  return (
    <Modal visible={!!task && !!draft} onClose={onClose} title="Задача">
      {draft && (
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Input value={draft.title} onChangeText={(v) => set('title', v)} placeholder="Что нужно сделать?" accessibilityLabel="Название задачи" />
          {extra}

          <Text style={styles.label}>Важность</Text>
          <ChipRow items={PRIORITY_CHIPS} selected={draft.priority} onSelect={(k) => set('priority', k)} styles={styles} />

          <Text style={styles.label}>Когда</Text>
          <View style={styles.daysRow}>
            {days.map((d) => {
              const on = draft.date === d.date;
              return (
                <TouchableOpacity
                  key={d.date}
                  style={[styles.chip, on && { backgroundColor: c.primary + '30', borderColor: c.primary }]}
                  onPress={() => set('date', d.date)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, on && { color: c.primary }]}>{d.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.whenRow}>
            <Input
              style={styles.whenDate}
              value={draft.date}
              onChangeText={(v) => set('date', v)}
              placeholder="ГГГГ-ММ-ДД"
              keyboardType="numbers-and-punctuation"
              accessibilityLabel="Дата"
            />
            <Input
              style={styles.whenTime}
              value={draft.time}
              onChangeText={(v) => set('time', v)}
              placeholder="Время"
              keyboardType="numbers-and-punctuation"
              accessibilityLabel="Время, ЧЧ:ММ, можно пусто"
            />
          </View>

          <Text style={styles.label}>Категория</Text>
          <ChipRow items={CATEGORY_CHIPS} selected={draft.category} onSelect={(k) => set('category', k)} styles={styles} />

          <Text style={styles.label}>Заметки</Text>
          <TextInput
            style={styles.notes}
            value={draft.notes}
            onChangeText={(v) => set('notes', v)}
            placeholder="Подробности…"
            placeholderTextColor={c.textMuted}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Заметки"
          />

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <View style={styles.buttons}>
            <Button title="Отмена" variant="outline" onPress={onClose} style={styles.button} />
            <Button title="Сохранить" onPress={() => void save()} loading={saving} disabled={saving} style={styles.button} />
          </View>
        </ScrollView>
      )}
    </Modal>
  );
});

const ChipRow = memo(function ChipRow({
  items,
  selected,
  onSelect,
  styles,
}: {
  items: Chip[];
  selected: string;
  onSelect: (key: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
      {items.map((it) => {
        const on = selected === it.key;
        return (
          <TouchableOpacity
            key={it.key}
            style={[styles.chip, on && { backgroundColor: it.color + '30', borderColor: it.color }]}
            onPress={() => onSelect(it.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.chipText, on && { color: it.color }]}>
              {it.icon} {it.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    label: { fontSize: fontSize.sm, fontWeight: '600', color: c.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
    chips: { gap: spacing.sm, paddingVertical: spacing.xs },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.xl,
      backgroundColor: c.surfaceLight,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipText: { fontSize: fontSize.sm, color: c.textSecondary },
    daysRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    whenRow: { flexDirection: 'row', gap: spacing.sm },
    whenDate: { flex: 3 },
    whenTime: { flex: 2 },
    notes: {
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      fontSize: fontSize.sm,
      color: c.text,
      minHeight: 72,
    },
    error: { color: c.danger, fontSize: fontSize.sm, marginTop: spacing.sm },
    buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.sm },
    button: { flex: 1 },
  });
}
