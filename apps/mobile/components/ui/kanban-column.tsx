import React, { useMemo, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { spacing, borderRadius, fontSize } from '@/constants';
import type { Theme } from '@/constants/themes';

interface KanbanTask {
  id: string;
  title: string;
  priority: string;
  category: string;
}

interface KanbanColumnProps {
  title: string;
  color: string;
  tasks: KanbanTask[];
  onTaskPress: (id: string) => void;
  onStatusChange: (taskId: string, newStatus: string) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: '#22C55E',
  medium: '#3B82F6',
  high: '#F97316',
  critical: '#EF4444',
};

const CATEGORY_ICONS: Record<string, string> = {
  work: 'briefcase',
  personal: 'user',
  health: 'heart',
  finance: 'dollar-sign',
  education: 'book',
  home: 'home',
};

const createStyles = (c: Theme, columnColor: string) =>
  StyleSheet.create({
    container: {
      width: 280,
      marginRight: spacing.md,
    },
    header: {
      borderTopWidth: 3,
      borderTopColor: columnColor,
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      borderTopLeftRadius: borderRadius.md,
      borderTopRightRadius: borderRadius.md,
      padding: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    headerTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: c.text,
    },
    countBadge: {
      backgroundColor: columnColor + '26',
      borderRadius: 10,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    countText: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      color: columnColor,
    },
    list: {
      flex: 1,
    },
    taskCard: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: c.border,
    },
    taskRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    priorityDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginRight: spacing.sm,
    },
    taskTitle: {
      flex: 1,
      fontSize: fontSize.sm,
      color: c.text,
      fontWeight: '500',
    },
    categoryIcon: {
      marginLeft: spacing.sm,
    },
  });

const TaskCard = React.memo(function TaskCard({
  task,
  styles,
  textSecondaryColor,
  onPress,
}: {
  task: KanbanTask;
  styles: ReturnType<typeof createStyles>;
  textSecondaryColor: string;
  onPress: () => void;
}) {
  const priorityColor = PRIORITY_COLORS[task.priority] || '#6B7280';
  const iconName = (CATEGORY_ICONS[task.category] || 'circle') as keyof typeof Feather.glyphMap;

  return (
    <TouchableOpacity style={styles.taskCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.taskRow}>
        <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
        <Text style={styles.taskTitle} numberOfLines={2}>
          {task.title}
        </Text>
        <Feather name={iconName} size={14} color={textSecondaryColor} style={styles.categoryIcon} />
      </View>
    </TouchableOpacity>
  );
});

export const KanbanColumn = React.memo(function KanbanColumn({
  title,
  color: columnColor,
  tasks,
  onTaskPress,
  onStatusChange: _onStatusChange,
}: KanbanColumnProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c, columnColor), [c, columnColor]);

  const renderTask = useCallback(
    ({ item }: { item: KanbanTask }) => (
      <TaskCard
        task={item}
        styles={styles}
        textSecondaryColor={c.textSecondary}
        onPress={() => onTaskPress(item.id)}
      />
    ),
    [styles, c.textSecondary, onTaskPress],
  );

  const keyExtractor = useCallback((item: KanbanTask) => item.id, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{tasks.length}</Text>
        </View>
      </View>
      <FlatList
        style={styles.list}
        data={tasks}
        renderItem={renderTask}
        keyExtractor={keyExtractor}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
});
