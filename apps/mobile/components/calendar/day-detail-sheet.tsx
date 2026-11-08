import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Modal, SwipeableRow, TapToAdd } from '@/components/ui';
import { spacing, fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { RU_MONTHS_GENITIVE } from '@/utils/dates';
import { priorityColor } from './calendar-logic';
import { EventLine } from './event-line';

interface DayTask {
  id: string;
  title: string;
  completed: boolean;
  priority?: string | null;
}
interface DayEvent {
  id: string;
  title: string;
  startTime: string | null;
  endTime?: string | null;
}

interface DayDetailSheetProps {
  dateKey: string | null; // 'YYYY-MM-DD' или null = закрыто
  tasks: DayTask[];
  events: DayEvent[];
  onClose: () => void;
  /** Новая задача на этот день (тап по бледной строке). */
  onAddTask: (title: string) => void | Promise<unknown>;
  /** Новое событие на этот день: «14:00 встреча с Ахметом». */
  onAddEvent?: (line: string) => void | Promise<unknown>;
  /** Тап по цветной точке — следующий цвет (= важность). */
  onCycleColor: (task: DayTask) => void;
  onToggle: (task: DayTask) => void;
  onDelete: (task: DayTask) => void;
  /** Тап по встрече — правка строкой («16:00 встреча»): время/название. */
  onEditEvent?: (event: DayEvent, next: { title: string; startTime?: string; endTime?: string }) => Promise<unknown>;
  /** Сдвиг встречи — удалить. */
  onDeleteEvent?: (event: DayEvent) => void;
}

function ruDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${d} ${RU_MONTHS_GENITIVE[m - 1]} ${y}`;
}

/**
 * День в календаре: задачи с цветом (= важность) и события; добавить задачу на
 * этот день — тап по бледной строке «Новая задача», без перехода в «Задачи».
 */
export function DayDetailSheet({
  dateKey,
  tasks,
  events,
  onClose,
  onAddTask,
  onAddEvent,
  onCycleColor,
  onToggle,
  onDelete,
  onEditEvent,
  onDeleteEvent,
}: DayDetailSheetProps) {
  const colors = useColors();

  return (
    <Modal visible={dateKey !== null} onClose={onClose} title={dateKey ? ruDate(dateKey) : ''}>
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        {(events.length > 0 || onAddEvent) && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>События</Text>
            {events.map((e) =>
              onEditEvent && onDeleteEvent ? (
                <EventLine key={e.id} event={e} onEdit={onEditEvent} onDelete={onDeleteEvent} />
              ) : (
                <Text key={e.id} style={[styles.row, { color: colors.text }]}>
                  {e.startTime ? `${e.startTime} · ` : ''}
                  {e.title}
                </Text>
              ),
            )}
            {onAddEvent ? <TapToAdd hint="Новое событие: «14:00 встреча»" onSubmit={onAddEvent} /> : null}
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Задачи</Text>
          {tasks.map((t) => (
            <SwipeableRow key={t.id} onDelete={() => onDelete(t)} deleteLabel="Удалить задачу">
              <View style={[styles.taskRow, { backgroundColor: colors.surface }]}>
                <Pressable
                  onPress={() => onCycleColor(t)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Сменить цвет задачи"
                  style={[styles.colorDot, { backgroundColor: priorityColor(t.priority) }]}
                />
                <Pressable style={styles.taskTitleWrap} onPress={() => onToggle(t)}>
                  <Text style={[styles.taskTitle, { color: colors.text }, t.completed && styles.doneRow]}>
                    {t.completed ? '✓ ' : ''}
                    {t.title}
                  </Text>
                </Pressable>
              </View>
            </SwipeableRow>
          ))}
          <TapToAdd hint="Новая задача" onSubmit={onAddTask} />
        </View>
        {tasks.length > 0 && (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            Цвет — важность: тап по кружку меняет его. Тап по задаче — выполнено. Тап по встрече — перенести.
          </Text>
        )}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { maxHeight: 460 },
  section: { marginBottom: spacing.md },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  row: { fontSize: fontSize.md, marginBottom: spacing.sm },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    marginBottom: spacing.xs,
  },
  colorDot: { width: 18, height: 18, borderRadius: 9 },
  taskTitleWrap: { flex: 1 },
  taskTitle: { fontSize: fontSize.md },
  doneRow: { opacity: 0.6, textDecorationLine: 'line-through' },
  hint: { fontSize: fontSize.xs, textAlign: 'center', marginBottom: spacing.sm },
});
