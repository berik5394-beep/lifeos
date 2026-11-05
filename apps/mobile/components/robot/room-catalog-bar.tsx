import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { ROOM_CATALOG, type RoomItemKey } from '@/services/room-catalog';

/** Робот-эпик, Часть 4: полоса бесплатной мебели «Обставить: 🪴 🛋️ …». */
export const RoomCatalogBar = memo(function RoomCatalogBar({ onPick }: { onPick: (key: RoomItemKey) => void }) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Обставить</Text>
      <View style={styles.row}>
        {ROOM_CATALOG.map((i) => (
          <Pressable
            key={i.key}
            onPress={() => onPick(i.key)}
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Поставить: ${i.label}`}
          >
            <Text style={styles.emoji}>{i.emoji}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    wrap: { marginHorizontal: spacing.md, marginTop: spacing.sm },
    label: { fontSize: fontSize.xs, color: c.textSecondary, marginBottom: spacing.xs },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    btn: {
      width: 40,
      height: 40,
      borderRadius: borderRadius.sm,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnPressed: { backgroundColor: c.surfaceLight, transform: [{ scale: 0.92 }] },
    emoji: { fontSize: 22 },
  });
}
