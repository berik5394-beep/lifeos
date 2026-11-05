import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { RoomTier } from '@/services/room-catalog';
import { ROOM_PALETTE, RENDER_SCALE as R } from './room-palette';

const ROW = 16 * R;

/**
 * Пол комнаты. Без ремонта — деревянные доски. Часть 6: класс ремонта —
 * линолеум (бюджет), ламинат (средний), широкая инженерная доска (премиум),
 * паркет «ёлочка» (люкс).
 */
export const WoodFloor = memo(function WoodFloor({
  width,
  height,
  tier = null,
}: {
  width: number;
  height: number;
  tier?: RoomTier | null;
}) {
  if (tier === 'budget') return <Linoleum width={width} height={height} />;
  if (tier === 'luxury') return <Herringbone width={width} height={height} />;
  const look =
    tier === 'mid'
      ? { bg: '#B98D5E', seam: '#9A7247', row: ROW }
      : tier === 'premium'
        ? { bg: '#6E4A2C', seam: '#4E331D', row: ROW * 1.6 }
        : { bg: ROOM_PALETTE.floor, seam: ROOM_PALETTE.floorSeam, row: ROW };
  const rows = Math.ceil(height / look.row);
  return (
    <View style={[styles.base, { backgroundColor: look.bg }]} pointerEvents="none">
      <View style={styles.plinth} />
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={[styles.row, { top: 6 * R + r * look.row, height: look.row, borderColor: look.seam }]}>
          {[0.18, 0.52, 0.86].map((p, k) => (
            <View key={k} style={[styles.joint, { left: ((p + (r % 2) * 0.17) % 1) * width, backgroundColor: look.seam }]} />
          ))}
          {tier === 'premium' && <View style={[styles.grain, { top: look.row * 0.45 }]} />}
        </View>
      ))}
    </View>
  );
});

/** Линолеум: ровное полотно с мелкой «плиткой». */
function Linoleum({ width, height }: { width: number; height: number }) {
  const cell = 26 * R;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  return (
    <View style={[styles.base, { backgroundColor: '#B8A684' }]} pointerEvents="none">
      <View style={styles.plinth} />
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) =>
          (r + c) % 2 === 0 ? (
            <View key={`${r}-${c}`} style={[styles.tile, { left: c * cell, top: 6 * R + r * cell, width: cell, height: cell }]} />
          ) : null,
        ),
      )}
    </View>
  );
}

/** Паркет «ёлочка»: дощечки под ±45° в два тона. */
function Herringbone({ width, height }: { width: number; height: number }) {
  const step = 18 * R;
  const cols = Math.ceil(width / step) + 2;
  const rows = Math.ceil(height / step) + 2;
  return (
    <View style={[styles.base, { backgroundColor: '#5B3418' }]} pointerEvents="none">
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => (
          <View
            key={`${r}-${c}`}
            style={[
              styles.plank,
              {
                left: c * step - step / 2,
                top: r * step,
                backgroundColor: (r + c) % 2 ? '#8B5A2B' : '#A06A35',
                transform: [{ rotate: `${c % 2 ? 45 : -45}deg` }],
              },
            ]}
          />
        )),
      )}
      <View style={styles.plinth} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { ...StyleSheet.absoluteFillObject, backgroundColor: ROOM_PALETTE.floor, overflow: 'hidden' },
  plinth: { height: 6 * R, backgroundColor: ROOM_PALETTE.plinth },
  row: { position: 'absolute', left: 0, right: 0, height: ROW, borderBottomWidth: 1 * R, borderColor: ROOM_PALETTE.floorSeam },
  joint: { position: 'absolute', top: 0, bottom: 0, width: 1 * R, backgroundColor: ROOM_PALETTE.floorSeam },
  grain: { position: 'absolute', left: 0, right: 0, height: 1 * R, backgroundColor: 'rgba(0,0,0,0.12)' },
  tile: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.10)' },
  plank: { position: 'absolute', width: 26 * R, height: 8 * R, borderRadius: 1, borderWidth: 0.5 * R, borderColor: 'rgba(40,20,5,0.5)' },
});
