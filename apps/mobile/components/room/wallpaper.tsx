import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ROOM_PALETTE, RENDER_SCALE as R } from './room-palette';

const STRIPE_EVERY = 22 * R;

/** Обои в полоску с мелким узором — классика квартиры. */
export const Wallpaper = memo(function Wallpaper({ width }: { width: number }) {
  const count = Math.ceil(width / STRIPE_EVERY);
  return (
    <View style={styles.base} pointerEvents="none">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.stripe, { left: i * STRIPE_EVERY }]}>
          {i % 2 === 0 &&
            Array.from({ length: 16 }, (_, j) => <View key={j} style={[styles.dot, { top: (10 + j * 34) * R }]} />)}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  base: { ...StyleSheet.absoluteFillObject, backgroundColor: ROOM_PALETTE.wallpaper, overflow: 'hidden' },
  stripe: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: STRIPE_EVERY / 2,
    backgroundColor: ROOM_PALETTE.wallpaperStripe,
    alignItems: 'center',
  },
  dot: {
    position: 'absolute',
    width: 4 * R,
    height: 4 * R,
    borderRadius: 2 * R,
    backgroundColor: ROOM_PALETTE.wallpaperDot,
  },
});
