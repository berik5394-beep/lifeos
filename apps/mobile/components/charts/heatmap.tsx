import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '@/constants';

interface HeatmapProps {
  data: Record<string, number>; // 'YYYY-MM-DD' -> completion percentage (0-100)
  year?: number;
}

const CELL_SIZE = 10;
const CELL_GAP = 2;
const MONTH_LABELS = [
  '\u042F', '\u0424', '\u041C', '\u0410', '\u041C',
  '\u0418', '\u0418', '\u0410', '\u0421', '\u041E',
  '\u041D', '\u0414',
]; // Я,Ф,М,А,М,И,И,А,С,О,Н,Д

const DAY_LABELS = [
  '\u041F\u043D', '', '\u0421\u0440', '', '\u041F\u0442', '', '\u0412\u0441',
]; // Пн, '', Ср, '', Пт, '', Вс

function getColor(value: number): string {
  if (value <= 0) return colors.surface;
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
}: {
  value: number;
}) {
  const bgColor = value < 0 ? 'transparent' : getColor(value);
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
          {'\u041C\u0435\u043D\u044C\u0448\u0435'}
        </Text>
        {[0, 15, 40, 65, 90].map((v) => (
          <View
            key={v}
            style={[styles.legendCell, { backgroundColor: getColor(v) }]}
          />
        ))}
        <Text style={styles.legendLabel}>
          {'\u0411\u043E\u043B\u044C\u0448\u0435'}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
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
    color: colors.textSecondary,
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
    color: colors.textSecondary,
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
    color: colors.textSecondary,
    fontSize: 8,
    marginHorizontal: 2,
  },
});
