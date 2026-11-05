import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ROOM_PALETTE, RENDER_SCALE as R } from './room-palette';

const ROW = 16 * R;

/** Деревянный пол из досок со смещёнными стыками + плинтус. */
export const WoodFloor = memo(function WoodFloor({ width, height }: { width: number; height: number }) {
  const rows = Math.ceil(height / ROW);
  return (
    <View style={styles.base} pointerEvents="none">
      <View style={styles.plinth} />
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={[styles.row, { top: 6 * R + r * ROW }]}>
          {[0.18, 0.52, 0.86].map((p, k) => (
            <View key={k} style={[styles.joint, { left: ((p + (r % 2) * 0.17) % 1) * width }]} />
          ))}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  base: { ...StyleSheet.absoluteFillObject, backgroundColor: ROOM_PALETTE.floor, overflow: 'hidden' },
  plinth: { height: 6 * R, backgroundColor: ROOM_PALETTE.plinth },
  row: { position: 'absolute', left: 0, right: 0, height: ROW, borderBottomWidth: 1 * R, borderColor: ROOM_PALETTE.floorSeam },
  joint: { position: 'absolute', top: 0, bottom: 0, width: 1 * R, backgroundColor: ROOM_PALETTE.floorSeam },
});
