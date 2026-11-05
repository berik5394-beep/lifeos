import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ROOM_PALETTE, RENDER_SCALE as R } from './room-palette';

/** Чугунная батарея-«гармошка» под окном. */
export const Radiator = memo(function Radiator({ width, height }: { width: number; height: number }) {
  const ribs = Math.max(4, Math.floor(width / (9 * R)));
  return (
    <View style={[styles.wrap, { width, height }]} pointerEvents="none">
      {Array.from({ length: ribs }, (_, i) => (
        <View key={i} style={styles.rib} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'absolute', flexDirection: 'row', gap: 2 * R },
  rib: {
    flex: 1,
    backgroundColor: ROOM_PALETTE.radiator,
    borderRadius: 3 * R,
    borderBottomWidth: 3 * R,
    borderColor: ROOM_PALETTE.radiatorShade,
  },
});
