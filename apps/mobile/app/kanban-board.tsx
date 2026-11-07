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
  Alert,
  Pressable,
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
import { TapToAdd } from '@/components/ui/tap-to-add';
import { hapticMedium, hapticLight } from '@/services/haptics';
import type { Theme } from '@/constants/themes';
import { formatDate } from '@/utils/dates';
import { useContentWidth } from '@/hooks/use-content-width';
import { TaskEditSheet } from '@/components/tasks/task-edit-sheet';
import {
  KANBAN_COLUMNS as COLUMNS,
  WIP_LIMIT,
  cardDue,
  categoryLabel,
  columnIndexAt,
  columnOf,
} from '@/components/kanban/kanban-logic';

const PRIORITY_COLORS: Record<string, string> = {
  low: '#22C55E',
  medium: '#3B82F6',
  high: '#F97316',
  critical: '#EF4444',
};

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
  onOpen: (taskId: string) => void;
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
  onOpen,
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

  const due = cardDue(item);
  const next = COLUMNS[columnIndex + 1];

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
        {/* Тап — открыть задачу (название, срок, важность, колонка). Зажать — тащить. */}
        <Pressable
          onPress={() => onOpen(item.id)}
          accessibilityRole="button"
          accessibilityLabel={`Открыть задачу ${item.title}`}
        >
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
        <View style={styles.dueRow}>
          <Feather name="calendar" size={12} color={due.overdue ? c.danger : c.textMuted} />
          <Text style={[styles.dueText, due.overdue && { color: c.danger }]} numberOfLines={1}>
            {due.label}
          </Text>
          <Text style={styles.cardCategory} numberOfLines={1}>
            {categoryLabel(item.category)}
          </Text>
        </View>
        </Pressable>
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
          {next ? (
            <TouchableOpacity
              onPress={() => onMoveTask(item.id, columnId, 'right')}
              style={styles.moveNext}
              accessibilityRole="button"
              accessibilityLabel={`Перенести в «${next.label}»`}
            >
              <Text style={[styles.moveNextText, { color: next.color }]}>{next.short}</Text>
              <Feather name="chevron-right" size={16} color={next.color} />
            </TouchableOpacity>
          ) : null}
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
  const quickAdd = useTaskStore((s) => s.quickAdd);
  const createTask = useTaskStore((s) => s.createTask);
  // «Новая задача» в КАЖДОЙ колонке (раньше только во второй — «К выполнению»,
  // а открывался «Бэклог» с «Пусто», и писать было негде). «К выполнению» —
  // разбор фразы («завтра в 15:00»); остальные — сразу в эту колонку на сегодня.
  // Ошибку покажет сама строка (текст не пропадёт).
  const handleAddToColumn = useCallback(
    (columnId: string, text: string) =>
      columnId === 'todo'
        ? quickAdd(text)
        : createTask({ title: text, category: 'personal', priority: 'medium', date: formatDate(new Date()), kanbanStatus: columnId }),
    [quickAdd, createTask],
  );
  // Колонка — ширина экрана без полей: листается ровно по колонке, без обрезки.
  const columnWidth = useContentWidth() - spacing.md * 2;
  const updateKanbanStatus = useTaskStore((s) => s.updateKanbanStatus);
  const token = useAuthStore((s) => s.token);
  const [draggingTask, setDraggingTask] = useState<string | null>(null);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  // Открытая карточка задачи (тап по карточке).
  const [openId, setOpenId] = useState<string | null>(null);
  const openTask = useMemo(() => tasks.find((t) => t.id === openId) ?? null, [tasks, openId]);
  // Переключатель колонок сверху: какая колонка сейчас на экране.
  const boardRef = useRef<ScrollView>(null);
  const step = columnWidth + spacing.xs * 2;
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const goToColumn = useCallback(
    (i: number) => {
      boardRef.current?.scrollTo({ x: i * step, animated: true });
      activeRef.current = i;
      setActive(i);
      hapticLight();
    },
    [step],
  );
  const columnLayouts = useRef<Record<string, { x: number; width: number }>>({});
  const scrollOffset = useSharedValue(0);

  useEffect(() => {
    if (token) fetchTasks();
  }, [token, fetchTasks]);

  const tasksByColumn = useMemo(() => {
    const map: Record<string, typeof tasks> = {};
    for (const col of COLUMNS) {
      // Галочка главнее колонки: выполненная — в «Готово» (отметил в списке или голосом).
      map[col.id] = tasks.filter((t) => columnOf(t) === col.id);
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
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const x = event.nativeEvent.contentOffset.x;
      scrollOffset.value = x;
      const i = columnIndexAt(x, step);
      if (i !== activeRef.current) {
        activeRef.current = i;
        setActive(i);
      }
    },
    [scrollOffset, step],
  );

  const moveOpenTo = useCallback(
    (status: string) => {
      if (!openTask) return;
      if (columnOf(openTask) !== status) {
        updateKanbanStatus(openTask.id, status);
        hapticLight();
      }
      setOpenId(null);
    },
    [openTask, updateKanbanStatus],
  );

  const removeOpen = useCallback(() => {
    if (!openTask) return;
    Alert.alert('Убрать задачу?', `«${openTask.title}» пропадёт с доски и из списка задач.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Убрать',
        style: 'destructive',
        onPress: () => {
          setOpenId(null);
          deleteTask(openTask.id).catch((e: unknown) =>
            Alert.alert('Не получилось', e instanceof Error ? e.message : 'Попробуй ещё раз.'),
          );
        },
      },
    ]);
  }, [openTask, deleteTask]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color={c.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} pointerEvents="none">Канбан</Text>
          <View style={styles.headerHint}>
            <Feather name="move" size={14} color={c.textMuted} />
            <Text style={styles.headerHintText}>Зажми карточку</Text>
          </View>
        </View>

        {/* Колонки одним касанием — доска встаёт ровно на выбранную. */}
        <View style={styles.switcher}>
          {COLUMNS.map((col, i) => {
            const n = (tasksByColumn[col.id] || []).length;
            const on = i === active;
            const over = col.id === 'in_progress' && n > WIP_LIMIT;
            return (
              <Pressable
                key={col.id}
                onPress={() => goToColumn(i)}
                style={[styles.switchPill, on && { backgroundColor: col.color + '33', borderColor: col.color }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${col.label}, задач: ${n}`}
              >
                <Text style={[styles.switchText, on && { color: c.text }]} numberOfLines={1}>
                  {col.short}
                </Text>
                <Text style={[styles.switchCount, { color: over ? c.danger : on ? col.color : c.textMuted }]}>{n}</Text>
              </Pressable>
            );
          })}
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
          ref={boardRef}
          horizontal
          snapToInterval={step}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
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
                style={[styles.column, { width: columnWidth }]}
                onLayout={handleColumnLayout(col.id)}
              >
                <View style={[styles.columnHeader, { borderTopColor: col.color }]}>
                  <Text style={styles.columnTitle}>{col.label}</Text>
                  <View style={[styles.countBadge, { backgroundColor: col.color }]}>
                    <Text style={styles.countText}>{colTasks.length}</Text>
                  </View>
                </View>

                {col.id === 'in_progress' && colTasks.length > WIP_LIMIT && (
                  <Text style={styles.wipHint}>
                    В работе больше {WIP_LIMIT} — закончи одну, прежде чем брать новую
                  </Text>
                )}

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
                      onOpen={setOpenId}
                      columnLayouts={columnLayouts}
                      scrollOffset={scrollOffset}
                    />
                  )}
                  keyboardShouldPersistTaps="handled"
                  // Добавление тапом по бледной строке (без плюсиков) — в любой колонке.
                  ListFooterComponent={
                    <TapToAdd hint="Новая задача" onSubmit={(t) => handleAddToColumn(col.id, t)} />
                  }
                />
              </View>
            );
          })}
        </ScrollView>

        <TaskEditSheet
          task={openTask}
          onClose={() => setOpenId(null)}
          extra={
            openTask ? (
              <View>
                <Text style={styles.sheetLabel}>Колонка</Text>
                <View style={styles.sheetColumns}>
                  {COLUMNS.map((col) => {
                    const on = columnOf(openTask) === col.id;
                    return (
                      <Pressable
                        key={col.id}
                        onPress={() => moveOpenTo(col.id)}
                        style={[styles.sheetColumn, on && { backgroundColor: col.color + '33', borderColor: col.color }]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`Перенести в «${col.label}»`}
                      >
                        <Text style={[styles.sheetColumnText, on && { color: col.color }]} numberOfLines={1}>
                          {col.short}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable onPress={removeOpen} style={styles.removeBtn} accessibilityRole="button" accessibilityLabel="Убрать задачу">
                  <Feather name="trash-2" size={14} color={c.danger} />
                  <Text style={styles.removeText}>Убрать задачу</Text>
                </Pressable>
              </View>
            ) : null
          }
        />
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
    // По центру экрана, а не между стрелкой и подсказкой (иначе съезжал влево).
    headerTitle: {
      position: 'absolute',
      left: 0,
      right: 0,
      textAlign: 'center',
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.text,
    },
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
    columnsContent: { paddingHorizontal: spacing.md - spacing.xs, paddingVertical: spacing.sm },
    column: {
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
    cardCategory: { fontSize: fontSize.xs, color: c.textMuted, marginLeft: 'auto', flexShrink: 0 },
    dueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
    dueText: { fontSize: fontSize.xs, color: c.textMuted, flexShrink: 1 },
    moveNext: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: spacing.xs, paddingLeft: spacing.sm },
    moveNextText: { fontSize: fontSize.xs, fontWeight: '600' },
    // Переключатель колонок под шапкой.
    switcher: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    switchPill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 7,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    switchText: { fontSize: fontSize.xs, fontWeight: '600', color: c.textSecondary, flexShrink: 1 },
    switchCount: { fontSize: fontSize.xs, fontWeight: '700' },
    wipHint: { fontSize: fontSize.xs, color: c.danger, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
    // Карточка задачи: колонка одним касанием + «Убрать».
    sheetLabel: { fontSize: fontSize.sm, fontWeight: '600', color: c.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
    sheetColumns: { flexDirection: 'row', gap: spacing.xs },
    sheetColumn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceLight,
    },
    sheetColumnText: { fontSize: fontSize.xs, fontWeight: '600', color: c.textSecondary },
    removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: spacing.sm, marginTop: spacing.xs },
    removeText: { fontSize: fontSize.sm, color: c.danger, fontWeight: '600' },
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
