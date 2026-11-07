import React, { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';

type Shelf = 'furnish' | null;

/**
 * Низ комнаты: «Инструменты» — перейти на экран инструментов (он слева, тот же
 * свайп), «Обставить» — каталог мебели. Строка разговора с роботом — общая,
 * под обоими экранами (ChatInputRow).
 */
export const RoomBottomBar = memo(function RoomBottomBar({
  onTools,
  shop,
  onShelfChange,
  compact = false,
  highlight = null,
}: {
  /** Перейти к инструментам. */
  onTools: () => void;
  /** Часть 6: магазин ремонта (полка «Обставить»). */
  shop: ReactNode;
  /** Открыли/закрыли полку — комната подсвечивает ячейки, грузит каталог. */
  onShelfChange?: (shelf: Shelf) => void;
  /** Открыта клавиатура: полки прячем, чтобы не съедать место. */
  compact?: boolean;
  /** Знакомство: подсветить кнопку, о которой говорит робот. */
  highlight?: 'tools' | 'furnish' | null;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [shelf, setShelf] = useState<Shelf>(null);
  useEffect(() => onShelfChange?.(shelf), [shelf, onShelfChange]);
  if (compact) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.toggles}>
        <Pressable
          style={[styles.toggle, highlight === 'tools' && styles.glow]}
          onPress={() => {
            setShelf(null);
            onTools();
          }}
          accessibilityRole="button"
          accessibilityLabel="Инструменты"
        >
          <Feather name="grid" size={15} color={c.text} />
          <Text style={styles.toggleText}>Инструменты</Text>
        </Pressable>
        <Pressable
          style={[styles.toggle, shelf === 'furnish' && styles.toggleOn, highlight === 'furnish' && styles.glow]}
          onPress={() => setShelf((cur) => (cur === 'furnish' ? null : 'furnish'))}
          accessibilityRole="button"
          accessibilityLabel="Обставить комнату"
        >
          <Feather name="home" size={15} color={c.text} />
          <Text style={styles.toggleText}>Обставить</Text>
        </Pressable>
      </View>
      {shelf === 'furnish' && <View>{shop}</View>}
    </View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    wrap: { paddingTop: spacing.xs, gap: spacing.xs },
    toggles: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
    // Две кнопки поровну на всю ширину — раньше жались влево, справа пустота.
    toggle: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 7,
      borderRadius: borderRadius.lg,
      backgroundColor: c.surface,
    },
    toggleOn: { backgroundColor: c.surfaceLight },
    // Подсветка на знакомстве — яркая рамка, как маркер в комиксе.
    glow: { borderWidth: 3, borderColor: c.warning },
    toggleText: { fontSize: fontSize.sm, color: c.text, fontWeight: '600' },
  });
}
