import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Modal, Button } from '@/components/ui';
import { spacing, fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { RU_MONTHS_GENITIVE } from '@/utils/dates';

interface DayTask {
  id: string;
  title: string;
  completed: boolean;
}
interface DayEvent {
  id: string;
  title: string;
  startTime: string | null;
}

interface DayDetailSheetProps {
  dateKey: string | null; // 'YYYY-MM-DD' или null = закрыто
  tasks: DayTask[];
  events: DayEvent[];
  onClose: () => void;
  onOpenTasks: () => void;
}

function ruDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${d} ${RU_MONTHS_GENITIVE[m - 1]} ${y}`;
}

export function DayDetailSheet({
  dateKey,
  tasks,
  events,
  onClose,
  onOpenTasks,
}: DayDetailSheetProps) {
  const colors = useColors();
  const isEmpty = tasks.length === 0 && events.length === 0;

  return (
    <Modal
      visible={dateKey !== null}
      onClose={onClose}
      title={dateKey ? ruDate(dateKey) : ''}
    >
      <ScrollView style={styles.container}>
        {isEmpty && (
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            На этот день ничего не запланировано
          </Text>
        )}

        {tasks.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              Задачи
            </Text>
            {tasks.map((t) => (
              <Text
                key={t.id}
                style={[
                  styles.row,
                  { color: colors.text },
                  t.completed && styles.doneRow,
                ]}
              >
                {t.completed ? '✓ ' : '✗ '}
                {t.title}
              </Text>
            ))}
          </View>
        )}

        {events.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              События
            </Text>
            {events.map((e) => (
              <Text key={e.id} style={[styles.row, { color: colors.text }]}>
                {e.startTime ? `${e.startTime} · ` : ''}
                {e.title}
              </Text>
            ))}
          </View>
        )}

        <Button title="Открыть в Задачах" onPress={onOpenTasks} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { maxHeight: 420 },
  empty: { fontSize: fontSize.md, marginVertical: spacing.lg, textAlign: 'center' },
  section: { marginBottom: spacing.md },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  row: { fontSize: fontSize.md, marginBottom: spacing.sm },
  doneRow: { opacity: 0.6 },
});
