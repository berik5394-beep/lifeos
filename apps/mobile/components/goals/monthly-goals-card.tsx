import React, { memo, useCallback, useEffect, useMemo } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { SwipeableRow, TapToAdd, InlineEntry } from '@/components/ui';
import { useColors } from '@/hooks/use-colors';
import type { Theme } from '@/constants/themes';
import { spacing, fontSize } from '@/constants';
import { hapticLight } from '@/services/haptics';
import { useGoalStore } from '@/stores/goal-store';
import { useScheduleStore } from '@/stores/schedule-store';

const MONTHS_PREP = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/**
 * Цели на месяц (аудит 2026-11-09): робот их ставил («в ноябре хочу похудеть на
 * 3 кг»), напоминал о них, а в приложении их не было вовсе — ни увидеть, ни
 * закрыть. Как цели недели: тап по пустому месту — новая, галочка — закрыть,
 * сдвиг — убрать, тап по тексту — переписать.
 */
export const MonthlyGoalsCard = memo(function MonthlyGoalsCard({ month }: { month: string }) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const goals = useGoalStore((s) => s.monthlyGoals);
  const fetchMonthlyGoals = useGoalStore((s) => s.fetchMonthlyGoals);
  const createMonthlyGoal = useGoalStore((s) => s.createMonthlyGoal);
  const updateMonthlyGoal = useGoalStore((s) => s.updateMonthlyGoal);
  const deleteMonthlyGoal = useGoalStore((s) => s.deleteMonthlyGoal);
  // Робот поставил/закрыл цель месяца в чате — перечитываем (тот же сигнал, что у задач).
  const revision = useScheduleStore((s) => s.revision);

  useEffect(() => {
    fetchMonthlyGoals(month).catch(() => {});
  }, [month, fetchMonthlyGoals, revision]);

  const title = `Цели на ${MONTHS_PREP[Number(month.slice(5, 7)) - 1] ?? 'месяц'}`;
  const done = goals.filter((g) => g.completed).length;

  const onAdd = useCallback((text: string) => createMonthlyGoal(month, text), [month, createMonthlyGoal]);
  const onToggle = useCallback(
    (id: string, completed: boolean) => {
      hapticLight();
      updateMonthlyGoal(id, { completed: !completed }).catch(() => Alert.alert('Не сохранилось', 'Попробуй ещё раз.'));
    },
    [updateMonthlyGoal],
  );
  const onRename = useCallback((id: string, goalText: string) => updateMonthlyGoal(id, { goalText }), [updateMonthlyGoal]);
  const onDelete = useCallback(
    (id: string) => {
      deleteMonthlyGoal(id).catch(() => Alert.alert('Не удалилось', 'Попробуй ещё раз.'));
    },
    [deleteMonthlyGoal],
  );

  return (
    <Card style={styles.card} tapToAdd>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {goals.length > 0 ? <Text style={styles.count}>{`${done} из ${goals.length}`}</Text> : null}
      </View>
      {goals.map((goal) => (
        <SwipeableRow key={goal.id} onDelete={() => onDelete(goal.id)} deleteLabel="Удалить цель">
          <View style={styles.row}>
            <Checkbox checked={goal.completed} onToggle={() => onToggle(goal.id, goal.completed)} size={20} />
            <InlineEntry
              style={styles.textWrap}
              placeholder={goal.goalText}
              onSubmit={(t) => onRename(goal.id, t)}
              accessibilityLabel={`Цель месяца: ${goal.goalText}. Нажми, чтобы переписать`}
            >
              <Text style={[styles.text, goal.completed && styles.textDone]} numberOfLines={2}>
                {goal.goalText}
              </Text>
            </InlineEntry>
          </View>
        </SwipeableRow>
      ))}
      <TapToAdd hint="Новая цель месяца" onSubmit={onAdd} />
    </Card>
  );
});

function createStyles(c: Theme) {
  return StyleSheet.create({
    card: { marginBottom: spacing.md },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    title: { color: c.text, fontSize: fontSize.lg, fontWeight: '700' },
    count: { color: c.textSecondary, fontSize: fontSize.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    textWrap: { flex: 1 },
    text: { flex: 1, color: c.text, fontSize: fontSize.sm },
    textDone: { textDecorationLine: 'line-through', color: c.textSecondary },
  });
}
