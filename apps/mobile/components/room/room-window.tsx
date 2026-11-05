import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ROOM_PALETTE, skyColor, RENDER_SCALE as R } from './room-palette';

/** Окно с крестом рамы, тюлем, шторами по бокам и подоконником. Небо — по времени суток. */
export const RoomWindow = memo(function RoomWindow({
  width,
  height,
  hour,
}: {
  width: number;
  height: number;
  hour: number;
}) {
  const curtainW = width * 0.22;
  return (
    <View style={[styles.wrap, { width: width + curtainW, height: height + 10 * R }]} pointerEvents="none">
      <View style={[styles.frame, { left: curtainW / 2, width, height }]}>
        <View style={[styles.glass, { backgroundColor: skyColor(hour) }]}>
          <View style={styles.crossV} />
          <View style={styles.crossH} />
          <View style={styles.tulle} />
        </View>
      </View>
      <View style={[styles.sill, { left: curtainW / 2 - 6 * R, width: width + 12 * R, top: height - 2 * R }]} />
      <Curtain style={[styles.curtain, { left: 0, width: curtainW, height: height + 6 * R }]} />
      <Curtain style={[styles.curtain, { right: 0, width: curtainW, height: height + 6 * R }]} />
    </View>
  );
});

const Curtain = memo(function Curtain({ style }: { style: object }) {
  return (
    <View style={style}>
      <View style={[styles.fold, { left: '25%' }]} />
      <View style={[styles.fold, { left: '60%' }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  frame: {
    position: 'absolute',
    top: 0,
    backgroundColor: ROOM_PALETTE.windowFrame,
    padding: 5 * R,
    borderRadius: 2 * R,
  },
  glass: { flex: 1, overflow: 'hidden' },
  crossV: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 5 * R, marginLeft: -2.5 * R, backgroundColor: ROOM_PALETTE.windowFrame },
  crossH: { position: 'absolute', left: 0, right: 0, top: '38%', height: 5 * R, backgroundColor: ROOM_PALETTE.windowFrame },
  tulle: { ...StyleSheet.absoluteFillObject, backgroundColor: ROOM_PALETTE.tulle },
  sill: { position: 'absolute', height: 8 * R, backgroundColor: ROOM_PALETTE.windowSill, borderRadius: 2 * R },
  curtain: {
    position: 'absolute',
    top: -6 * R,
    backgroundColor: ROOM_PALETTE.curtain,
    borderBottomLeftRadius: 6 * R,
    borderBottomRightRadius: 6 * R,
  },
  fold: { position: 'absolute', top: 0, bottom: 0, width: 3 * R, backgroundColor: ROOM_PALETTE.curtainFold },
});
