import React, { useMemo, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { spacing, borderRadius, fontSize } from '@/constants';
import type { Theme } from '@/constants/themes';

interface MatrixTask {
  id: string;
  title: string;
  urgency: number;
  importance: number;
  category: string;
}

interface EisenhowerMatrixProps {
  tasks: MatrixTask[];
  onTaskPress: (id: string) => void;
}

interface Quadrant {
  key: string;
  label: string;
  color: string;
  filter: (t: MatrixTask) => boolean;
}

const QUADRANTS: Quadrant[] = [
  {
    key: 'urgent-important',
    label: 'Срочное и важное',
    color: '#EF4444',
    filter: (t) => t.urgency >= 5 && t.importance >= 5,
  },
  {
    key: 'important-not-urgent',
    label: 'Важное, не срочное',
    color: '#3B82F6',
    filter: (t) => t.urgency < 5 && t.importance >= 5,
  },
  {
    key: 'urgent-not-important',
    label: 'Срочное, не важное',
    color: '#F59E0B',
    filter: (t) => t.urgency >= 5 && t.importance < 5,
  },
  {
    key: 'neither',
    label: 'Не срочное, не важное',
    color: '#6B7280',
    filter: (t) => t.urgency < 5 && t.importance < 5,
  },
];

const createStyles = (c: Theme) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    quadrant: {
      width: '48.5%',
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: c.border,
      minHeight: 140,
      overflow: 'hidden',
    },
    quadrantHeader: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    quadrantTitle: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: '#fff',
    },
    quadrantList: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      flex: 1,
    },
    taskItem: {
      paddingVertical: 3,
    },
    taskText: {
      fontSize: 11,
      color: c.text,
    },
    emptyText: {
      fontSize: 11,
      color: c.textSecondary,
      fontStyle: 'italic',
    },
  });

const QuadrantView = React.memo(function QuadrantView({
  quadrant,
  filteredTasks,
  styles,
  emptyColor,
  onTaskPress,
}: {
  quadrant: Quadrant;
  filteredTasks: MatrixTask[];
  styles: ReturnType<typeof createStyles>;
  emptyColor: string;
  onTaskPress: (id: string) => void;
}) {
  const renderItem = useCallback(
    ({ item }: { item: MatrixTask }) => (
      <TouchableOpacity style={styles.taskItem} onPress={() => onTaskPress(item.id)} activeOpacity={0.7}>
        <Text style={styles.taskText} numberOfLines={1}>
          {item.title}
        </Text>
      </TouchableOpacity>
    ),
    [styles, onTaskPress],
  );

  const keyExtractor = useCallback((item: MatrixTask) => item.id, []);

  return (
    <View style={styles.quadrant}>
      <View style={[styles.quadrantHeader, { backgroundColor: quadrant.color }]}>
        <Text style={styles.quadrantTitle}>{quadrant.label}</Text>
      </View>
      <View style={styles.quadrantList}>
        {filteredTasks.length === 0 ? (
          <Text style={styles.emptyText}>Пусто</Text>
        ) : (
          <FlatList
            data={filteredTasks}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            scrollEnabled={false}
          />
        )}
      </View>
    </View>
  );
});

export const EisenhowerMatrix = React.memo(function EisenhowerMatrix({
  tasks,
  onTaskPress,
}: EisenhowerMatrixProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  const quadrantData = useMemo(
    () =>
      QUADRANTS.map((q) => ({
        quadrant: q,
        tasks: tasks.filter(q.filter),
      })),
    [tasks],
  );

  return (
    <View style={styles.container}>
      {quadrantData.map(({ quadrant, tasks: qTasks }) => (
        <QuadrantView
          key={quadrant.key}
          quadrant={quadrant}
          filteredTasks={qTasks}
          styles={styles}
          emptyColor={c.textSecondary}
          onTaskPress={onTaskPress}
        />
      ))}
    </View>
  );
});
