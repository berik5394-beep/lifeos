import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Button, Input, Modal, Checkbox } from '@/components/ui';
import { VoiceButton, VoiceModal } from '@/components/voice';
import { useVoice } from '@/hooks/use-voice';
import { colors, spacing, borderRadius, fontSize, taskCategories, priorities } from '@/constants';
import { useTaskStore } from '@/stores/task-store';
import { getWeekDays, formatDate, isToday, isSameDay } from '@/utils/dates';

const CATEGORY_KEYS = Object.keys(taskCategories) as Array<keyof typeof taskCategories>;
const PRIORITY_KEYS = Object.keys(priorities) as Array<keyof typeof priorities>;

interface WeekDayItem {
  date: Date;
  label: string;
  dayNum: number;
}

const DayButton = React.memo(function DayButton({
  item,
  isSelected,
  onPress,
}: {
  item: WeekDayItem;
  isSelected: boolean;
  onPress: () => void;
}) {
  const today = isToday(item.date);

  return (
    <TouchableOpacity
      style={[
        styles.dayButton,
        isSelected && styles.dayButtonSelected,
        today && !isSelected && styles.dayButtonToday,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.dayLabel,
          isSelected && styles.dayLabelSelected,
        ]}
      >
        {item.label}
      </Text>
      <Text
        style={[
          styles.dayNum,
          isSelected && styles.dayNumSelected,
        ]}
      >
        {item.dayNum}
      </Text>
    </TouchableOpacity>
  );
});

interface TaskItemData {
  id: string;
  title: string;
  category: string;
  priority: string;
  completed: boolean;
  time: string | null;
}

const TaskItem = React.memo(function TaskItem({
  task,
  onToggle,
  onDelete,
}: {
  task: TaskItemData;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const cat = taskCategories[task.category as keyof typeof taskCategories];
  const prio = priorities[task.priority as keyof typeof priorities];

  return (
    <Card style={styles.taskCard}>
      <View style={styles.taskRow}>
        <Checkbox
          checked={task.completed}
          onToggle={onToggle}
          color={prio?.color ?? colors.primary}
        />
        <View style={styles.taskContent}>
          <Text
            style={[
              styles.taskTitle,
              task.completed && styles.taskTitleCompleted,
            ]}
            numberOfLines={2}
          >
            {task.title}
          </Text>
          <View style={styles.taskMeta}>
            {cat && (
              <View style={[styles.badge, { backgroundColor: cat.color + '20' }]}>
                <Text style={[styles.badgeText, { color: cat.color }]}>
                  {cat.icon} {cat.label}
                </Text>
              </View>
            )}
            {prio && (
              <View style={[styles.badge, { backgroundColor: prio.color + '20' }]}>
                <Text style={[styles.badgeText, { color: prio.color }]}>
                  {prio.icon} {prio.label}
                </Text>
              </View>
            )}
            {task.time && (
              <Text style={styles.taskTime}>{task.time}</Text>
            )}
          </View>
        </View>
        <TouchableOpacity onPress={onDelete} hitSlop={8}>
          <Text style={styles.deleteIcon}>🗑</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
});

export default function TasksScreen() {
  const { tasks, isLoading, fetchTasks, createTask, toggleComplete, deleteTask } =
    useTaskStore();

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>(CATEGORY_KEYS[0]);
  const [priority, setPriority] = useState<string>(PRIORITY_KEYS[1]);
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [voiceModalVisible, setVoiceModalVisible] = useState(false);

  const {
    isRecording,
    isProcessing,
    lastResult,
    error: voiceError,
    startRecording,
    stopRecording,
  } = useVoice();

  const handleVoicePress = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      setVoiceModalVisible(true);
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);
  const dateStr = useMemo(() => formatDate(selectedDate), [selectedDate]);

  useEffect(() => {
    fetchTasks(dateStr).catch(() => {});
  }, [dateStr, fetchTasks]);

  const handleCreate = useCallback(async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      await createTask({
        title: title.trim(),
        category,
        priority,
        date: dateStr,
        time: time.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setTitle('');
      setTime('');
      setNotes('');
      setModalVisible(false);
    } catch {
      Alert.alert('Ошибка', 'Не удалось создать задачу');
    } finally {
      setCreating(false);
    }
  }, [title, category, priority, dateStr, time, notes, createTask]);

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert('Удалить задачу?', 'Это действие нельзя отменить', [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => deleteTask(id).catch(() => {}),
        },
      ]);
    },
    [deleteTask],
  );

  const renderTask = useCallback(
    ({ item }: { item: TaskItemData }) => (
      <TaskItem
        task={item}
        onToggle={() => toggleComplete(item.id)}
        onDelete={() => handleDelete(item.id)}
      />
    ),
    [toggleComplete, handleDelete],
  );

  const keyExtractor = useCallback((item: TaskItemData) => item.id, []);

  const completedCount = tasks.filter((t) => t.completed).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Задачи</Text>
        {tasks.length > 0 && (
          <Text style={styles.counter}>
            {completedCount}/{tasks.length}
          </Text>
        )}
      </View>

      {/* Week day selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.weekRow}
      >
        {weekDays.map((day) => (
          <DayButton
            key={day.dayNum}
            item={day}
            isSelected={isSameDay(day.date, selectedDate)}
            onPress={() => setSelectedDate(day.date)}
          />
        ))}
      </ScrollView>

      {/* Task list */}
      <FlatList
        data={tasks}
        renderItem={renderTask}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshing={isLoading}
        onRefresh={() => fetchTasks(dateStr).catch(() => {})}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>Нет задач на этот день</Text>
          </View>
        }
      />

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Create task modal */}
      <Modal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        title="Добавить задачу"
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          <Input
            label="Название"
            placeholder="Введите название задачи"
            value={title}
            onChangeText={setTitle}
          />

          <Text style={styles.pickerLabel}>Категория</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pickerRow}
          >
            {CATEGORY_KEYS.map((key) => {
              const cat = taskCategories[key];
              const selected = category === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.pickerChip,
                    { borderColor: cat.color },
                    selected && { backgroundColor: cat.color + '30' },
                  ]}
                  onPress={() => setCategory(key)}
                >
                  <Text style={[styles.pickerChipText, { color: cat.color }]}>
                    {cat.icon} {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.pickerLabel}>Приоритет</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pickerRow}
          >
            {PRIORITY_KEYS.map((key) => {
              const prio = priorities[key];
              const selected = priority === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.pickerChip,
                    { borderColor: prio.color },
                    selected && { backgroundColor: prio.color + '30' },
                  ]}
                  onPress={() => setPriority(key)}
                >
                  <Text style={[styles.pickerChipText, { color: prio.color }]}>
                    {prio.icon} {prio.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Input
            label="Время (необязательно)"
            placeholder="HH:MM"
            value={time}
            onChangeText={setTime}
            style={styles.inputSpacing}
          />

          <Input
            label="Заметки (необязательно)"
            placeholder="Добавьте заметку"
            value={notes}
            onChangeText={setNotes}
            multiline
            style={styles.inputSpacing}
          />

          <Button
            title="Создать задачу"
            onPress={handleCreate}
            loading={creating}
            disabled={!title.trim()}
            style={styles.createButton}
          />
        </ScrollView>
      </Modal>

      {/* Floating Voice Button */}
      <VoiceButton
        onPress={handleVoicePress}
        isRecording={isRecording}
        isProcessing={isProcessing}
        style={styles.floatingVoice}
      />

      {/* Voice Modal */}
      <VoiceModal
        visible={voiceModalVisible}
        onClose={() => setVoiceModalVisible(false)}
        isRecording={isRecording}
        isProcessing={isProcessing}
        result={lastResult}
        error={voiceError}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  screenTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  counter: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  weekRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  dayButton: {
    width: 48,
    height: 64,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  dayButtonSelected: {
    backgroundColor: colors.primary,
  },
  dayButtonToday: {
    borderWidth: 1,
    borderColor: colors.primary,
  },
  dayLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  dayLabelSelected: {
    color: colors.text,
  },
  dayNum: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  dayNumSelected: {
    color: colors.text,
  },
  list: {
    padding: spacing.md,
    paddingBottom: 100,
    gap: spacing.sm,
  },
  taskCard: {
    marginBottom: spacing.xs,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  taskContent: {
    flex: 1,
    gap: spacing.xs,
  },
  taskTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: colors.textSecondary,
  },
  taskMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  taskTime: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
  deleteIcon: {
    fontSize: 18,
    marginTop: 2,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.md,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  fabText: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '300',
    marginTop: -2,
  },
  pickerLabel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  pickerRow: {
    flexGrow: 0,
    marginBottom: spacing.xs,
  },
  pickerChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    marginRight: spacing.sm,
  },
  pickerChipText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  inputSpacing: {
    marginTop: spacing.md,
  },
  createButton: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  floatingVoice: {
    position: 'absolute',
    bottom: 90,
    right: 20,
  },
});
