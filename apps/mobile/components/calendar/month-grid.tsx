import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { spacing, borderRadius, fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { formatDate, isToday, RU_DAYS_SHORT } from '@/utils/dates';
import {
  buildMonthMatrix,
  dayMarker,
  heatColor,
  type DayStat,
} from './calendar-logic';

interface MonthGridProps {
  year: number;
  month: number; // 0-based
  dayStats: Record<string, DayStat>;
  eventDays: Set<string>;
  /** Цветные точки задач дня (цвет = важность), самые важные первыми. */
  dayColors?: Record<string, string[]>;
  onDayPress: (dateKey: string) => void;
}

export const MonthGrid = React.memo(function MonthGrid({
  year,
  month,
  dayStats,
  eventDays,
  dayColors = {},
  onDayPress,
}: MonthGridProps) {
  const colors = useColors();
  const weeks = useMemo(() => buildMonthMatrix(year, month), [year, month]);
  const todayKey = formatDate(new Date());

  return (
    <View>
      {/* Заголовки дней недели */}
      <View style={styles.weekRow}>
        {RU_DAYS_SHORT.map((d) => (
          <View key={d} style={styles.cell}>
            <Text style={[styles.dowLabel, { color: colors.textSecondary }]}>{d}</Text>
          </View>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((cell) => {
            const stat = dayStats[cell.dateKey];
            const isPast = cell.dateKey <= todayKey;
            const marker = dayMarker(stat, eventDays.has(cell.dateKey), isPast);
            const bg = cell.inMonth
              ? heatColor(stat?.donePct ?? 0, colors.surface)
              : 'transparent';
            const isCellToday = isToday(cell.date);

            return (
              <Pressable
                key={cell.dateKey}
                style={styles.cell}
                onPress={() => cell.inMonth && onDayPress(cell.dateKey)}
                disabled={!cell.inMonth}
              >
                <View
                  style={[
                    styles.dayBox,
                    { backgroundColor: bg },
                    isCellToday && { borderColor: colors.primary, borderWidth: 2 },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNum,
                      { color: cell.inMonth ? colors.text : colors.textSecondary },
                      !cell.inMonth && styles.dimmed,
                    ]}
                  >
                    {cell.day}
                  </Text>
                  {cell.inMonth && (dayColors[cell.dateKey]?.length ?? 0) > 0 ? (
                    <View style={styles.dots}>
                      {dayColors[cell.dateKey].map((col) => (
                        <View key={col} style={[styles.dot, { backgroundColor: col }]} />
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.marker}>
                      {marker === 'check'
                        ? '✓'
                        : marker === 'cross'
                          ? '✗'
                          : marker === 'dot'
                            ? '•'
                            : ' '}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  weekRow: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs },
  dowLabel: { fontSize: fontSize.xs, fontWeight: '600' },
  dayBox: {
    width: 40,
    height: 44,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNum: { fontSize: fontSize.sm, fontWeight: '600' },
  dimmed: { opacity: 0.4 },
  marker: { fontSize: 10, height: 12, color: '#F8FAFC' },
  dots: { flexDirection: 'row', gap: 2, height: 12, alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});
