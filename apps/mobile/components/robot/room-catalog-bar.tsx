import React, { memo, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { spacing, borderRadius } from '@/constants';
import { ROOM_CATALOG, type RoomItemKey } from '@/services/room-catalog';

/** Робот-эпик: полка бесплатной мебели — листается вбок (предметов больше, чем влезает). */
export const RoomCatalogBar = memo(function RoomCatalogBar({ onPick }: { onPick: (key: RoomItemKey) => void }) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
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
    </ScrollView>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    row: { gap: spacing.sm, paddingHorizontal: spacing.md },
    btn: {
      width: 44,
      height: 44,
      borderRadius: borderRadius.sm,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnPressed: { backgroundColor: c.surfaceLight, transform: [{ scale: 0.92 }] },
    emoji: { fontSize: 24 },
  });
}
