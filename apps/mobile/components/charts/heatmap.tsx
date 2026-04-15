import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';

interface HeatmapProps {
  data: Record<string, number>; // 'YYYY-MM-DD' -> completion percentage (0-100)
  year?: number;
}

const CELL_SIZE = 10;
const CELL_GAP = 2;
const MONTH_LABELS = [
  'Я', 'Ф', 'М', 'А', 'М',
  'И', 'И', 'А', 'С', 'О',
  'Н', 'Д',
]; // Я,Ф,М,А,М,И,И,А,С,О,Н,Д

const DAY_LABELS = [
  'Пн', '', 'Ср', '', 'Пт', '', 'Вс',
]; // Пн, '', Ср, '', Пт, '', Вс

function getColor(value: number, surfaceColor: string): string {
  if (value <= 0) return surfaceColor;
  if (value <= 25) return '#064E3B';
  if (value <= 50) return '#059669';
  if (value <= 75) return '#34D399';
  return '#22C55E';
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface WeekColumn {
  weekIndex: number;
  days: { date: Date; value: number; dayOfWeek: number }[];
}

function buildGrid(data: Record<string, number>, year: number): {
  weeks: WeekColumn[];
  monthPositions: { label: string; weekIndex: number }[];
} {
  // Find the first Monday of or before Jan 1
  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay(); // 0=Sun
  const startOffset = jan1Day === 0 ? -6 : 1 - jan1Day;
  const startDate = new Date(year, 0, 1 + startOffset);

  const dec31 = new Date(year, 11, 31);

  const weeks: WeekColumn[] = [];
  const monthPositions: { label: string; weekIndex: number }[] = [];
  const seenMonths = new Set<number>();

  let currentDate = new Date(startDate);
  let weekIndex = 0;

  while (currentDate <= dec31 || currentDate.getDay() !== 1) {
    const week: WeekColumn = { weekIndex, days: [] };

    for (let d = 0; d < 7; d++) {
      const dayOfWeek = d; // 0=Mon, 6=Sun
      const dateKey = formatDateKey(currentDate);
      const inYear = currentDate.getFullYear() === year;
      const value = inYear ? (data[dateKey] ?? 0) : -1;

      // Track month positions
      if (inYear && !seenMonths.has(currentDate.getMonth())) {
        seenMonths.add(currentDate.getMonth());
        monthPositions.push({
          label: MONTH_LABELS[currentDate.getMonth()],
          weekIndex,
        });
      }

      week.days.push({ date: new Date(currentDate), value, dayOfWeek });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    weeks.push(week);
    weekIndex++;

    if (currentDate > dec31 && currentDate.getDay() === 1) break;
    if (weekIndex > 54) break; // safety
  }

  return { weeks, monthPositions };
}

const HeatmapCell = React.memo(function HeatmapCell({
  value,
  surfaceColor,
}: {
  value: number;
  surfaceColor: string;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const bgColor = value < 0 ? 'transparent' : getColor(value, surfaceColor);
  return (
    <View
      style={[
        styles.cell,
        { backgroundColor: bgColor },
      ]}
    />
  );
});

export const Heatmap = React.memo(function Heatmap({
  data,
  year,
}: HeatmapProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const displayYear = year ?? new Date().getFullYear();

  const { weeks, monthPositions } = useMemo(
    () => buildGrid(data, displayYear),
    [data, displayYear],
  );

  return (
    <View style={styles.container}>
      {/* Day labels on the left */}
      <View style={styles.dayLabelsColumn}>
        <View style={styles.monthLabelSpacer} />
        {DAY_LABELS.map((label, i) => (
          <View key={i} style={styles.dayLabelCell}>
            <Text style={styles.dayLabelText}>{label}</Text>
          </View>
        ))}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View>
          {/* Month labels row */}
          <View style={styles.monthLabelsRow}>
            {weeks.map((week) => {
              const monthEntry = monthPositions.find(
                (mp) => mp.weekIndex === week.weekIndex,
              );
              return (
                <View key={week.weekIndex} style={styles.monthLabelCell}>
                  <Text style={styles.monthLabelText}>
                    {monthEntry?.label ?? ''}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Grid rows (one per day of week) */}
          {Array.from({ length: 7 }, (_, dayIndex) => (
            <View key={dayIndex} style={styles.gridRow}>
              {weeks.map((week) => {
                const dayData = week.days[dayIndex];
                return (
                  <HeatmapCell
                    key={week.weekIndex}
                    value={dayData?.value ?? -1}
                    surfaceColor={c.surface}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendLabel}>
          {'Меньше'}
        </Text>
        {[0, 15, 40, 65, 90].map((v) => (
          <View
            key={v}
            style={[styles.legendCell, { backgroundColor: getColor(v, c.surface) }]}
          />
        ))}
        <Text style={styles.legendLabel}>
          {'Больше'}
        </Text>
      </View>
    </View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    flexDirection: 'column',
  },
  dayLabelsColumn: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 1,
  },
  monthLabelSpacer: {
    height: CELL_SIZE + CELL_GAP,
  },
  dayLabelCell: {
    height: CELL_SIZE + CELL_GAP,
    justifyContent: 'center',
    width: 20,
  },
  dayLabelText: {
    color: c.textSecondary,
    fontSize: 8,
  },
  scrollView: {
    marginLeft: 22,
  },
  scrollContent: {
    paddingRight: spacing.md,
  },
  monthLabelsRow: {
    flexDirection: 'row',
    height: CELL_SIZE + CELL_GAP,
  },
  monthLabelCell: {
    width: CELL_SIZE + CELL_GAP,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthLabelText: {
    color: c.textSecondary,
    fontSize: 8,
    fontWeight: '600',
  },
  gridRow: {
    flexDirection: 'row',
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 2,
    margin: CELL_GAP / 2,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
    marginTop: spacing.sm,
    paddingRight: spacing.sm,
  },
  legendCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 2,
  },
  legendLabel: {
    color: c.textSecondary,
    fontSize: 8,
    marginHorizontal: 2,
  },
  });
}
