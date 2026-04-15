import React, { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Dimensions,
  LayoutChangeEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  SharedValue,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useTaskStore } from '@/stores/task-store';
import { useAuthStore } from '@/stores/auth-store';
import { TagChip } from '@/components/ui/tag-chip';
import { hapticMedium, hapticLight } from '@/services/haptics';
import type { Theme } from '@/constants/themes';

const COLUMNS = [
  { id: 'backlog', label: 'Бэклог', color: '#6B7280' },
  { id: 'todo', label: 'К выполнению', color: '#3B82F6' },
  { id: 'in_progress', label: 'В работе', color: '#F59E0B' },
  { id: 'done', label: 'Готово', color: '#22C55E' },
] as const;

const PRIORITY_COLORS: Record<string, string> = {
  low: '#22C55E',
  medium: '#3B82F6',
  high: '#F97316',
  critical: '#EF4444',
};

const COLUMN_WIDTH = 280;
const SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.8 };

type DragState = {
  taskId: string;
  fromColumn: string;
  startX: number;
  startY: number;
} | null;

interface DraggableCardProps {
  item: any;
  columnId: string;
  columnIndex: number;
  styles: ReturnType<typeof createStyles>;
  c: Theme;
  onDragStart: (taskId: string, columnId: string) => void;
  onDragEnd: (taskId: string, targetColumnId: string | null) => void;
  onMoveTask: (taskId: string, currentStatus: string, direction: 'left' | 'right') => void;
  columnLayouts: React.MutableRefObject<Record<string, { x: number; width: number }>>;
  scrollOffset: SharedValue<number>;
}

const DraggableCard = React.memo(function DraggableCard({
  item,
  columnId,
  columnIndex,
  styles,
  c,
  onDragStart,
  onDragEnd,
  onMoveTask,
  columnLayouts,
  scrollOffset,
}: DraggableCardProps) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const zIndex = useSharedValue(0);
  const opacity = useSharedValue(1);
  const isDragging = useSharedValue(false);

  const findTargetColumn = useCallback(
    (absoluteX: number): string | null => {
      const scroll = scrollOffset.value;
      for (const col of COLUMNS) {
        const layout = columnLayouts.current[col.id];
        if (!layout) continue;
        const colLeft = layout.x - scroll;
        const colRight = colLeft + layout.width;
        if (absoluteX >= colLeft && absoluteX <= colRight) {
          return col.id;
        }
      }
      return null;
    },
    [columnLayouts, scrollOffset],
  );

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(200)
    .onStart(() => {
      isDragging.value = true;
      scale.value = withSpring(1.06, SPRING_CONFIG);
      zIndex.value = 1000;
      opacity.value = 0.9;
      runOnJS(onDragStart)(item.id, columnId);
      runOnJS(hapticMedium)();
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const targetCol = findTargetColumn(e.absoluteX);
      isDragging.value = false;
      scale.value = withSpring(1, SPRING_CONFIG);
      zIndex.value = 0;
      opacity.value = withTiming(1, { duration: 150 });
      translateX.value = withSpring(0, SPRING_CONFIG);
      translateY.value = withSpring(0, SPRING_CONFIG);

      if (targetCol && targetCol !== columnId) {
        runOnJS(onDragEnd)(item.id, targetCol);
        runOnJS(hapticLight)();
      } else {
        runOnJS(onDragEnd)(item.id, null);
      }
    })
    .onFinalize(() => {
      isDragging.value = false;
      scale.value = withSpring(1, SPRING_CONFIG);
      zIndex.value = 0;
      opacity.value = withTiming(1, { duration: 150 });
      translateX.value = withSpring(0, SPRING_CONFIG);
      translateY.value = withSpring(0, SPRING_CONFIG);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    zIndex: zIndex.value,
    opacity: opacity.value,
    shadowOpacity: isDragging.value ? 0.3 : 0,
    shadowRadius: isDragging.value ? 8 : 0,
    elevation: isDragging.value ? 10 : 0,
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[styles.card, animatedStyle]}>
        <View style={styles.cardTop}>
          <View
            style={[
              styles.priorityDot,
              { backgroundColor: PRIORITY_COLORS[item.priority] || '#6B7280' },
            ]}
          />
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.title}
          </Text>
        </View>
        {item.taskTags && item.taskTags.length > 0 && (
          <View style={styles.tagsRow}>
            {item.taskTags.slice(0, 3).map((tt: any) => (
              <TagChip
                key={tt.id || tt.tag.id}
                name={tt.tag.name}
                color={tt.tag.color}
                size="small"
              />
            ))}
          </View>
        )}
        <View style={styles.cardActions}>
          <TouchableOpacity
            onPress={() => onMoveTask(item.id, columnId, 'left')}
            disabled={columnId === 'backlog'}
            style={[styles.moveBtn, columnId === 'backlog' && styles.moveBtnDisabled]}
          >
            <Feather
              name="chevron-left"
              size={16}
              color={columnId === 'backlog' ? c.textMuted : c.text}
            />
          </TouchableOpacity>
          <Text style={styles.cardCategory}>{item.category}</Text>
          <TouchableOpacity
            onPress={() => onMoveTask(item.id, columnId, 'right')}
            disabled={columnId === 'done'}
            style={[styles.moveBtn, columnId === 'done' && styles.moveBtnDisabled]}
          >
            <Feather
              name="chevron-right"
              size={16}
              color={columnId === 'done' ? c.textMuted : c.text}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.dragHint}>
          <Feather name="more-horizontal" size={14} color={c.textMuted} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

export default function KanbanBoardScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
  const tasks = useTaskStore((s) => s.tasks);
  const loading = useTaskStore((s) => s.isLoading);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const updateKanbanStatus = useTaskStore((s) => s.updateKanbanStatus);
  const token = useAuthStore((s) => s.token);
  const [draggingTask, setDraggingTask] = useState<string | null>(null);
  const columnLayouts = useRef<Record<string, { x: number; width: number }>>({});
  const scrollOffset = useSharedValue(0);

  useEffect(() => {
    if (token) fetchTasks();
  }, [token, fetchTasks]);

  const tasksByColumn = useMemo(() => {
    const map: Record<string, typeof tasks> = {};
    for (const col of COLUMNS) {
      map[col.id] = tasks.filter((t) => (t.kanbanStatus || 'todo') === col.id);
    }
    return map;
  }, [tasks]);

  const handleMoveTask = useCallback(
    (taskId: string, currentStatus: string, direction: 'left' | 'right') => {
      const idx = COLUMNS.findIndex((col) => col.id === currentStatus);
      const newIdx = direction === 'right' ? idx + 1 : idx - 1;
      if (newIdx < 0 || newIdx >= COLUMNS.length) return;
      updateKanbanStatus(taskId, COLUMNS[newIdx].id);
      hapticLight();
    },
    [updateKanbanStatus],
  );

  const handleDragStart = useCallback((taskId: string, _columnId: string) => {
    setDraggingTask(taskId);
  }, []);

  const handleDragEnd = useCallback(
    (taskId: string, targetColumnId: string | null) => {
      if (targetColumnId) {
        updateKanbanStatus(taskId, targetColumnId);
      }
      setDraggingTask(null);
    },
    [updateKanbanStatus],
  );

  const handleColumnLayout = useCallback(
    (columnId: string) => (event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout;
      columnLayouts.current[columnId] = { x, width };
    },
    [],
  );

  const handleScroll = useCallback(
    (event: any) => {
      scrollOffset.value = event.nativeEvent.contentOffset.x;
    },
    [scrollOffset],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color={c.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Kanban</Text>
          <View style={styles.headerHint}>
            <Feather name="move" size={14} color={c.textMuted} />
            <Text style={styles.headerHintText}>Зажми карточку</Text>
          </View>
        </View>

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={c.primary} />
          </View>
        )}

        {/* Column indicators */}
        {draggingTask && (
          <View style={styles.dropIndicatorRow}>
            {COLUMNS.map((col) => (
              <View key={col.id} style={[styles.dropIndicator, { borderColor: col.color }]}>
                <Text style={[styles.dropIndicatorText, { color: col.color }]}>
                  {col.label}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Columns */}
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.columnsContent}
          scrollEnabled={!draggingTask}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          {COLUMNS.map((col, colIndex) => {
            const colTasks = tasksByColumn[col.id] || [];
            return (
              <View
                key={col.id}
                style={styles.column}
                onLayout={handleColumnLayout(col.id)}
              >
                <View style={[styles.columnHeader, { borderTopColor: col.color }]}>
                  <Text style={styles.columnTitle}>{col.label}</Text>
                  <View style={[styles.countBadge, { backgroundColor: col.color }]}>
                    <Text style={styles.countText}>{colTasks.length}</Text>
                  </View>
                </View>

                <FlatList
                  data={colTasks}
                  keyExtractor={(item) => item.id}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.cardList}
                  renderItem={({ item }) => (
                    <DraggableCard
                      item={item}
                      columnId={col.id}
                      columnIndex={colIndex}
                      styles={styles}
                      c={c}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onMoveTask={handleMoveTask}
                      columnLayouts={columnLayouts}
                      scrollOffset={scrollOffset}
                    />
                  )}
                />

                {colTasks.length === 0 && (
                  <View style={styles.emptyColumn}>
                    <Feather name="inbox" size={24} color={c.textMuted} />
                    <Text style={styles.emptyText}>Пусто</Text>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

function createStyles(c: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    backButton: { padding: spacing.xs },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: c.text },
    headerHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    headerHintText: {
      fontSize: fontSize.xs,
      color: c.textMuted,
    },
    loadingRow: { paddingVertical: spacing.xs, alignItems: 'center' },
    dropIndicatorRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    dropIndicator: {
      flex: 1,
      marginHorizontal: 2,
      paddingVertical: 4,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderRadius: borderRadius.sm,
      alignItems: 'center',
    },
    dropIndicatorText: {
      fontSize: 10,
      fontWeight: '600',
    },
    columnsContent: { paddingHorizontal: spacing.sm },
    column: {
      width: COLUMN_WIDTH,
      marginHorizontal: spacing.xs,
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      overflow: 'hidden',
      maxHeight: '100%',
    },
    columnHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: 3,
    },
    columnTitle: { fontSize: fontSize.sm, fontWeight: '600', color: c.text },
    countBadge: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    countText: { fontSize: fontSize.xs, fontWeight: '700', color: '#FFF' },
    cardList: { paddingHorizontal: spacing.sm, paddingBottom: spacing.md },
    card: {
      backgroundColor: c.background,
      borderRadius: borderRadius.sm,
      padding: spacing.sm,
      marginBottom: spacing.xs,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
    },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
    priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
    cardTitle: { flex: 1, fontSize: fontSize.sm, color: c.text, lineHeight: 18 },
    tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: spacing.xs },
    cardActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.xs,
    },
    moveBtn: { padding: spacing.xs },
    moveBtnDisabled: { opacity: 0.3 },
    cardCategory: { fontSize: fontSize.xs, color: c.textMuted },
    dragHint: {
      alignItems: 'center',
      marginTop: 2,
      opacity: 0.4,
    },
    emptyColumn: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xl,
      gap: spacing.xs,
    },
    emptyText: {
      fontSize: fontSize.xs,
      color: c.textMuted,
    },
  });
}
