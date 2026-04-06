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
import { colors, spacing, borderRadius, fontSize, habitCategories } from '@/constants';
import { useHabitStore } from '@/stores/habit-store';
import { formatDate, getMonthKey } from '@/utils/dates';

const CATEGORY_KEYS = Object.keys(habitCategories) as Array<keyof typeof habitCategories>;
const FREQUENCY_OPTIONS = [
  { key: 'daily', label: 'Ежедневно' },
  { key: 'weekly', label: 'Еженедельно' },
] as const;

interface HabitItemData {
  id: string;
  name: string;
  category: string;
  frequency: string;
  active: boolean;
}

const HabitItem = React.memo(function HabitItem({
  habit,
  isCompleted,
  onToggle,
  onDelete,
  stat,
}: {
  habit: HabitItemData;
  isCompleted: boolean;
  onToggle: () => void;
  onDelete: () => void;
  stat: { completed: number; streak: number } | null;
}) {
  const cat = habitCategories[habit.category as keyof typeof habitCategories];

  return (
    <Card style={styles.habitCard}>
      <View style={styles.habitRow}>
        <Checkbox
          checked={isCompleted}
          onToggle={onToggle}
          color={cat?.color ?? colors.primary}
        />
        <View style={styles.habitContent}>
          <Text style={styles.habitName}>{habit.name}</Text>
          <View style={styles.habitMeta}>
            {cat && (
              <View style={[styles.badge, { backgroundColor: cat.color + '20' }]}>
                <Text style={[styles.badgeText, { color: cat.color }]}>
                  {cat.icon} {cat.label}
                </Text>
              </View>
            )}
            <Text style={styles.frequencyText}>
              {habit.frequency === 'daily' ? 'Ежедневно' : 'Еженедельно'}
            </Text>
          </View>
          {stat && (
            <View style={styles.statRow}>
              <Text style={styles.statText}>
                {stat.streak > 0 ? `🔥 ${stat.streak} дн.` : ''}
                {stat.streak > 0 && stat.completed > 0 ? '  ·  ' : ''}
                {stat.completed > 0 ? `✅ ${stat.completed} за месяц` : ''}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={onDelete} hitSlop={8}>
          <Text style={styles.deleteIcon}>🗑</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
});

export default function HabitsScreen() {
  const {
    habits,
    logs,
    stats,
    isLoading,
    fetchHabits,
    createHabit,
    deleteHabit,
    toggleHabitLog,
    fetchStats,
  } = useHabitStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(CATEGORY_KEYS[0]);
  const [frequency, setFrequency] = useState<string>('daily');
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

  const today = useMemo(() => formatDate(new Date()), []);
  const monthKey = useMemo(() => getMonthKey(new Date()), []);

  const todayLogs = logs[today] ?? [];

  useEffect(() => {
    fetchHabits().catch(() => {});
    fetchStats(monthKey).catch(() => {});
  }, [fetchHabits, fetchStats, monthKey]);

  const activeHabits = useMemo(
    () => habits.filter((h) => h.active),
    [habits],
  );

  const isHabitCompleted = useCallback(
    (habitId: string): boolean => {
      return todayLogs.some((l) => l.habitId === habitId && l.completed);
    },
    [todayLogs],
  );

  const getHabitStat = useCallback(
    (habitId: string) => {
      const s = stats.find((st) => st.habitId === habitId);
      if (!s) return null;
      return { completed: s.completed, streak: s.streak };
    },
    [stats],
  );

  const handleToggle = useCallback(
    (habitId: string) => {
      const completed = !isHabitCompleted(habitId);
      toggleHabitLog(habitId, today, completed).catch(() => {});
    },
    [isHabitCompleted, toggleHabitLog, today],
  );

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert('Удалить привычку?', 'Это действие нельзя отменить', [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => deleteHabit(id).catch(() => {}),
        },
      ]);
    },
    [deleteHabit],
  );

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createHabit({
        name: name.trim(),
        category,
        frequency,
      });
      setName('');
      setModalVisible(false);
    } catch {
      Alert.alert('Ошибка', 'Не удалось создать привычку');
    } finally {
      setCreating(false);
    }
  }, [name, category, frequency, createHabit]);

  const completedCount = activeHabits.filter((h) => isHabitCompleted(h.id)).length;

  const renderHabit = useCallback(
    ({ item }: { item: HabitItemData }) => (
      <HabitItem
        habit={item}
        isCompleted={isHabitCompleted(item.id)}
        onToggle={() => handleToggle(item.id)}
        onDelete={() => handleDelete(item.id)}
        stat={getHabitStat(item.id)}
      />
    ),
    [isHabitCompleted, handleToggle, handleDelete, getHabitStat],
  );

  const keyExtractor = useCallback((item: HabitItemData) => item.id, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Привычки</Text>
        {activeHabits.length > 0 && (
          <Text style={styles.counter}>
            {completedCount}/{activeHabits.length}
          </Text>
        )}
      </View>

      {/* Progress bar */}
      {activeHabits.length > 0 && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${(completedCount / activeHabits.length) * 100}%`,
                },
              ]}
            />
          </View>
        </View>
      )}

      <FlatList
        data={activeHabits}
        renderItem={renderHabit}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshing={isLoading}
        onRefresh={() => {
          fetchHabits().catch(() => {});
          fetchStats(monthKey).catch(() => {});
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🎯</Text>
            <Text style={styles.emptyText}>
              Нет привычек. Добавьте первую!
            </Text>
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

      {/* Create habit modal */}
      <Modal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        title="Добавить привычку"
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          <Input
            label="Название"
            placeholder="Введите название привычки"
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.pickerLabel}>Категория</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pickerRow}
          >
            {CATEGORY_KEYS.map((key) => {
              const cat = habitCategories[key];
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

          <Text style={styles.pickerLabel}>Частота</Text>
          <View style={styles.frequencyRow}>
            {FREQUENCY_OPTIONS.map((opt) => {
              const selected = frequency === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.frequencyChip,
                    selected && styles.frequencyChipSelected,
                  ]}
                  onPress={() => setFrequency(opt.key)}
                >
                  <Text
                    style={[
                      styles.frequencyChipText,
                      selected && styles.frequencyChipTextSelected,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Button
            title="Создать привычку"
            onPress={handleCreate}
            loading={creating}
            disabled={!name.trim()}
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
  progressContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.surfaceLight,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: 3,
  },
  list: {
    padding: spacing.md,
    paddingBottom: 100,
    gap: spacing.sm,
  },
  habitCard: {
    marginBottom: spacing.xs,
  },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  habitContent: {
    flex: 1,
    gap: spacing.xs,
  },
  habitName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  habitMeta: {
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
  frequencyText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
  statRow: {
    marginTop: 2,
  },
  statText: {
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
  frequencyRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  frequencyChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  frequencyChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '30',
  },
  frequencyChipText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  frequencyChipTextSelected: {
    color: colors.primary,
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
