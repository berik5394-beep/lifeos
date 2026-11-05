import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { borderRadius, fontSize, spacing } from '@/constants';
import type { PlanStatus } from '@/services/deals';
import { planHint, planLine, planProgress } from '@/services/deals-view';

/** Полоска плана месяца; отстаёшь по темпу — жёлтая. Тап — задать/изменить план. */
export const PlanBar = memo(function PlanBar({ plan, onPress }: { plan: PlanStatus | null; onPress: () => void }) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  if (!plan) {
    return (
      <Pressable onPress={onPress} style={styles.box} accessibilityRole="button">
        <Text style={styles.empty}>Задать план продаж на месяц</Text>
      </Pressable>
    );
  }
  const hint = planHint(plan);
  return (
    <Pressable onPress={onPress} style={styles.box} accessibilityRole="button" accessibilityHint="Изменить план месяца">
      <Text style={styles.line}>{planLine(plan)}</Text>
      <View style={styles.bar}>
        <View style={[plan.pace.behind ? styles.fillBehind : styles.fill, { width: `${planProgress(plan) * 100}%` }]} />
      </View>
      {hint ? <Text style={plan.pace.behind ? styles.hintBehind : styles.hint}>{hint}</Text> : null}
    </Pressable>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    box: { padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.lg, backgroundColor: c.surface },
    empty: { color: c.primary, fontSize: fontSize.md, fontWeight: '600', textAlign: 'center' },
    line: { color: c.text, fontSize: fontSize.md, fontWeight: '600', marginBottom: spacing.sm },
    bar: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: c.surfaceLight },
    fill: { height: 8, backgroundColor: c.success },
    fillBehind: { height: 8, backgroundColor: c.warning },
    hint: { color: c.textSecondary, fontSize: fontSize.xs, marginTop: spacing.sm },
    hintBehind: { color: c.warning, fontSize: fontSize.xs, marginTop: spacing.sm },
  });
}
