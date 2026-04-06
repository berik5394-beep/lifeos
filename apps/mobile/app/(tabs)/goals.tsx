import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useGoalStore } from '@/stores/goal-store';
import { goalAreas } from '@/constants/categories';
import { colors, spacing, fontSize, borderRadius } from '@/constants';

type GoalAreaKey = keyof typeof goalAreas;
const AREA_KEYS = Object.keys(goalAreas) as GoalAreaKey[];

const ProgressBar = React.memo(function ProgressBar({
  progress,
}: {
  progress: number;
}) {
  const clampedProgress = Math.min(100, Math.max(0, progress));
  return (
    <View style={styles.progressBarContainer}>
      <View style={styles.progressBarTrack}>
        <View
          style={[
            styles.progressBarFill,
            { width: `${clampedProgress}%` as `${number}%` },
          ]}
        />
      </View>
      <Text style={styles.progressBarText}>{Math.round(clampedProgress)}%</Text>
    </View>
  );
});

const GoalCard = React.memo(function GoalCard({
  id,
  area,
  goalText,
  progress,
  habits,
  onUpdateProgress,
  onDelete,
}: {
  id: string;
  area: string;
  goalText: string;
  progress: number;
  habits?: { id: string; name: string; category: string }[];
  onUpdateProgress: (id: string, progress: number) => void;
  onDelete: (id: string) => void;
}) {
  const areaInfo = goalAreas[area as GoalAreaKey];
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(Math.round(progress)));

  const handleSaveProgress = useCallback(() => {
    const value = parseInt(editValue, 10);
    if (!isNaN(value) && value >= 0 && value <= 100) {
      onUpdateProgress(id, value);
    }
    setEditing(false);
  }, [editValue, id, onUpdateProgress]);

  const handleDelete = useCallback(() => {
    Alert.alert('Удалить цель?', `"${goalText}"`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => onDelete(id) },
    ]);
  }, [id, goalText, onDelete]);

  return (
    <Card style={styles.goalCard}>
      <View style={styles.goalHeader}>
        <View style={styles.goalAreaBadge}>
          <Text style={styles.goalAreaIcon}>{areaInfo?.icon ?? '🎯'}</Text>
          <Text style={styles.goalAreaLabel}>
            {areaInfo?.label ?? area}
          </Text>
        </View>
        <TouchableOpacity onPress={handleDelete} hitSlop={8}>
          <Text style={styles.deleteIcon}>✕</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.goalText}>{goalText}</Text>

      {editing ? (
        <View style={styles.editProgressRow}>
          <Input
            value={editValue}
            onChangeText={setEditValue}
            keyboardType="number-pad"
            placeholder="0-100"
            onSubmitEditing={handleSaveProgress}
            returnKeyType="done"
            style={styles.progressInput}
          />
          <Button title="OK" onPress={handleSaveProgress} size="sm" />
          <Button
            title="Отмена"
            onPress={() => setEditing(false)}
            variant="outline"
            size="sm"
          />
        </View>
      ) : (
        <TouchableOpacity onPress={() => setEditing(true)}>
          <ProgressBar progress={progress} />
        </TouchableOpacity>
      )}

      {habits && habits.length > 0 && (
        <View style={styles.habitsSection}>
          <Text style={styles.habitsLabel}>Привязанные привычки:</Text>
          {habits.map((h) => (
            <Text key={h.id} style={styles.habitItem}>
              {'  '}• {h.name}
            </Text>
          ))}
        </View>
      )}
    </Card>
  );
});

export default function GoalsScreen() {
  const currentYear = new Date().getFullYear();
  const [yearOffset, setYearOffset] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedArea, setSelectedArea] = useState<GoalAreaKey>(AREA_KEYS[0]);
  const [goalTextInput, setGoalTextInput] = useState('');

  const year = currentYear + yearOffset;

  const {
    yearlyGoals,
    isLoading,
    fetchYearlyGoals,
    createYearlyGoal,
    updateYearlyGoal,
    deleteYearlyGoal,
  } = useGoalStore();

  useEffect(() => {
    fetchYearlyGoals(year);
  }, [year, fetchYearlyGoals]);

  const goalsByArea = useMemo(() => {
    const grouped: Record<string, typeof yearlyGoals> = {};
    for (const area of AREA_KEYS) {
      const areaGoals = yearlyGoals.filter((g) => g.area === area);
      if (areaGoals.length > 0) {
        grouped[area] = areaGoals;
      }
    }
    return grouped;
  }, [yearlyGoals]);

  const handleCreate = useCallback(async () => {
    if (!goalTextInput.trim()) return;
    try {
      await createYearlyGoal({
        year,
        area: selectedArea,
        goalText: goalTextInput.trim(),
      });
      setGoalTextInput('');
      setModalVisible(false);
    } catch {
      // Error handled by store
    }
  }, [goalTextInput, selectedArea, year, createYearlyGoal]);

  const handleUpdateProgress = useCallback(
    async (id: string, progress: number) => {
      try {
        await updateYearlyGoal(id, { progress });
      } catch {
        // Error handled by store
      }
    },
    [updateYearlyGoal],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteYearlyGoal(id);
      } catch {
        // Error handled by store
      }
    },
    [deleteYearlyGoal],
  );

  const handlePrevYear = useCallback(() => {
    setYearOffset((prev) => prev - 1);
  }, []);

  const handleNextYear = useCallback(() => {
    setYearOffset((prev) => prev + 1);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={styles.screenTitle}>Цели на год</Text>

        {/* Year Navigation */}
        <View style={styles.yearNav}>
          <TouchableOpacity onPress={handlePrevYear} hitSlop={12}>
            <Text style={styles.navArrow}>{'<'}</Text>
          </TouchableOpacity>
          <Text style={styles.yearLabel}>{year}</Text>
          <TouchableOpacity onPress={handleNextYear} hitSlop={12}>
            <Text style={styles.navArrow}>{'>'}</Text>
          </TouchableOpacity>
        </View>

        {/* Goals by Area */}
        {isLoading ? (
          <ActivityIndicator
            color={colors.primary}
            size="large"
            style={styles.loader}
          />
        ) : yearlyGoals.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Нет целей на {year} год. Добавьте свою первую цель!
            </Text>
          </Card>
        ) : (
          Object.entries(goalsByArea).map(([area, goals]) => {
            const areaInfo = goalAreas[area as GoalAreaKey];
            return (
              <View key={area} style={styles.areaSection}>
                <Text style={styles.areaSectionTitle}>
                  {areaInfo?.icon ?? ''} {areaInfo?.label ?? area}
                </Text>
                {goals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    id={goal.id}
                    area={goal.area}
                    goalText={goal.goalText}
                    progress={goal.progress}
                    habits={goal.habits}
                    onUpdateProgress={handleUpdateProgress}
                    onDelete={handleDelete}
                  />
                ))}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>

      {/* Add Goal Modal */}
      <Modal
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setGoalTextInput('');
        }}
        title="Добавить цель"
      >
        <Text style={styles.modalLabel}>Область</Text>
        <View style={styles.areaSelector}>
          {AREA_KEYS.map((areaKey) => {
            const area = goalAreas[areaKey];
            const isSelected = selectedArea === areaKey;
            return (
              <TouchableOpacity
                key={areaKey}
                style={[
                  styles.areaChip,
                  isSelected && styles.areaChipSelected,
                ]}
                onPress={() => setSelectedArea(areaKey)}
                activeOpacity={0.7}
              >
                <Text style={styles.areaChipIcon}>{area.icon}</Text>
                <Text
                  style={[
                    styles.areaChipLabel,
                    isSelected && styles.areaChipLabelSelected,
                  ]}
                >
                  {area.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Input
          label="Цель"
          value={goalTextInput}
          onChangeText={setGoalTextInput}
          placeholder="Опишите вашу цель..."
          multiline
          numberOfLines={3}
          style={styles.goalInputField}
        />

        <Button
          title="Добавить цель"
          onPress={handleCreate}
          disabled={!goalTextInput.trim()}
          style={styles.modalButton}
        />
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 3,
  },
  screenTitle: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  yearNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  navArrow: {
    color: colors.primary,
    fontSize: fontSize.xl,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
  },
  yearLabel: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  loader: {
    marginVertical: spacing.xl,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  areaSection: {
    marginBottom: spacing.lg,
  },
  areaSectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  goalCard: {
    marginBottom: spacing.sm,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  goalAreaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  goalAreaIcon: {
    fontSize: fontSize.md,
  },
  goalAreaLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  deleteIcon: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    padding: spacing.xs,
  },
  goalText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressBarTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.surfaceLight,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressBarText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    minWidth: 36,
    textAlign: 'right',
  },
  editProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressInput: {
    flex: 1,
  },
  habitsSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  habitsLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  habitItem: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    paddingVertical: 2,
  },
  fab: {
    position: 'absolute',
    bottom: spacing.xl + 60,
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabIcon: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 30,
  },
  modalLabel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  areaSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  areaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  areaChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  areaChipIcon: {
    fontSize: fontSize.sm,
  },
  areaChipLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  areaChipLabelSelected: {
    color: colors.text,
  },
  goalInputField: {
    marginBottom: spacing.md,
  },
  modalButton: {
    marginTop: spacing.sm,
  },
});
