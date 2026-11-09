import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ROOM_PALETTE, RENDER_SCALE as R } from './room-palette';
import { SoftSpot } from './face-light';

/** Абажур на шнуре под потолком; вечером/ночью светит. */
export const CeilingLamp = memo(function CeilingLamp({ lit }: { lit: boolean }) {
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.cord} />
      {/* Ореол — мягкое пятно с затуханием к краю (был сплошной круг с резким
          краем: вечером на стене висел плоский диск). */}
      {lit && (
        <View style={styles.glow}>
          <SoftSpot id="lampHalo" cx={0.5} cy={0.5} rx={0.5} ry={0.5} color="#FFC878" opacity={0.45} />
        </View>
      )}
      <View style={styles.shade} />
      <View style={styles.bulb} />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, alignSelf: 'center', alignItems: 'center' },
  cord: { width: 2 * R, height: 34 * R, backgroundColor: ROOM_PALETTE.lampCord },
  shade: {
    width: 64 * R,
    height: 26 * R,
    backgroundColor: ROOM_PALETTE.lampShade,
    borderTopLeftRadius: 32 * R,
    borderTopRightRadius: 32 * R,
  },
  bulb: { width: 12 * R, height: 6 * R, borderBottomLeftRadius: 6 * R, borderBottomRightRadius: 6 * R, backgroundColor: '#FFE7A8' },
  glow: {
    position: 'absolute',
    top: 20 * R,
    width: 180 * R,
    height: 180 * R,
  },
});
