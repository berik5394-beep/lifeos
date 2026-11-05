import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ROOM_PALETTE, RENDER_SCALE as R } from './room-palette';

/** Ковёр на стене: рамка-орнамент, медальон по центру, бахрома по краям. */
export const WallCarpet = memo(function WallCarpet({ width, height }: { width: number; height: number }) {
  const medallion = Math.min(width, height) * 0.38;
  return (
    <View style={[styles.wrap, { width, height }]} pointerEvents="none">
      <Fringe />
      <View style={styles.body}>
        <View style={styles.inner}>
          {/* Медальон из повёрнутых квадратов */}
          <View style={[styles.diamond, { width: medallion, height: medallion }]} />
          <View style={[styles.diamondInner, { width: medallion * 0.55, height: medallion * 0.55 }]} />
          {/* Угловые мотивы */}
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
        </View>
      </View>
      <Fringe />
    </View>
  );
});

/** Бахрома ковра — ряд коротких нитей. */
const Fringe = memo(function Fringe() {
  return (
    <View style={styles.fringe}>
      {Array.from({ length: 18 }, (_, i) => (
        <View key={i} style={styles.thread} />
      ))}
    </View>
  );
});

const CORNER = 10;
const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  fringe: { height: 5 * R, flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 4 * R },
  thread: { width: 1.5 * R, height: 5 * R, backgroundColor: ROOM_PALETTE.carpetBorder },
  body: {
    flex: 1,
    backgroundColor: ROOM_PALETTE.carpet,
    borderWidth: 5 * R,
    borderColor: ROOM_PALETTE.carpetBorder,
    padding: 5 * R,
  },
  inner: {
    flex: 1,
    backgroundColor: ROOM_PALETTE.carpetInner,
    borderWidth: 2 * R,
    borderColor: ROOM_PALETTE.carpetMotif,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diamond: {
    position: 'absolute',
    backgroundColor: ROOM_PALETTE.carpet,
    borderWidth: 3 * R,
    borderColor: ROOM_PALETTE.carpetMotif,
    transform: [{ rotate: '45deg' }],
  },
  diamondInner: {
    position: 'absolute',
    backgroundColor: ROOM_PALETTE.carpetMotif,
    transform: [{ rotate: '45deg' }],
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    backgroundColor: ROOM_PALETTE.carpetMotif,
    transform: [{ rotate: '45deg' }],
  },
  tl: { top: 6 * R, left: 6 * R },
  tr: { top: 6 * R, right: 6 * R },
  bl: { bottom: 6 * R, left: 6 * R },
  br: { bottom: 6 * R, right: 6 * R },
});
