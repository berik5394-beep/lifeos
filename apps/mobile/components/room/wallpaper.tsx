import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { RoomTier } from '@/services/room-catalog';
import { ROOM_PALETTE, RENDER_SCALE as R } from './room-palette';

const STRIPE_EVERY = 22 * R;

/**
 * Стены комнаты. Без ремонта (и «бюджет») — бумажные обои в полоску, как в
 * квартире. Часть 6: класс ремонта меняет отделку — виниловые обои, декоративная
 * штукатурка, венецианская штукатурка/мрамор с прожилками.
 */
export const Wallpaper = memo(function Wallpaper({ width, tier = null }: { width: number; tier?: RoomTier | null }) {
  if (tier === 'mid') return <Vinyl width={width} />;
  if (tier === 'premium') return <Plaster width={width} />;
  if (tier === 'luxury') return <Marble width={width} />;
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

/** Виниловые обои: ровный светлый тон с мелким ромбом. */
function Vinyl({ width }: { width: number }) {
  const cols = Math.ceil(width / (28 * R));
  return (
    <View style={[styles.base, { backgroundColor: '#CFC6B4' }]} pointerEvents="none">
      {Array.from({ length: cols }, (_, i) =>
        Array.from({ length: 18 }, (_, j) => (
          <View
            key={`${i}-${j}`}
            style={[styles.diamond, { left: (i * 28 + (j % 2) * 14) * R, top: (8 + j * 30) * R }]}
          />
        )),
      )}
    </View>
  );
}

/** Декоративная штукатурка: мягкие разводы. */
function Plaster({ width }: { width: number }) {
  const spots = Math.ceil(width / (40 * R)) * 6;
  return (
    <View style={[styles.base, { backgroundColor: '#D9D1C2' }]} pointerEvents="none">
      {Array.from({ length: spots }, (_, k) => {
        const size = (36 + ((k * 37) % 40)) * R;
        return (
          <View
            key={k}
            style={[
              styles.blot,
              {
                width: size,
                height: size * 0.7,
                left: ((k * 53) % Math.max(1, Math.round(width))) - size / 3,
                top: ((k * 71) % 520) * R,
                backgroundColor: k % 2 ? 'rgba(255,255,255,0.18)' : 'rgba(150,130,100,0.12)',
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/** Венецианская штукатурка / мрамор: светлый камень с короткими мягкими прожилками. */
function Marble({ width }: { width: number }) {
  const n = Math.ceil(width / (18 * R)) * 3;
  const w = Math.max(1, Math.round(width));
  return (
    <View style={[styles.base, { backgroundColor: '#EEE9E1' }]} pointerEvents="none">
      {Array.from({ length: n }, (_, k) => (
        <View
          key={k}
          style={[
            styles.vein,
            {
              left: (k * 47) % w,
              top: ((k * 89) % 560) * R,
              width: (14 + ((k * 23) % 26)) * R,
              transform: [{ rotate: `${(k % 2 ? 1 : -1) * (15 + ((k * 13) % 40))}deg` }],
              backgroundColor: k % 4 === 0 ? 'rgba(201,162,39,0.4)' : 'rgba(120,120,128,0.22)',
            },
          ]}
        />
      ))}
    </View>
  );
}

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
  diamond: {
    position: 'absolute',
    width: 5 * R,
    height: 5 * R,
    backgroundColor: 'rgba(255,255,255,0.35)',
    transform: [{ rotate: '45deg' }],
  },
  blot: { position: 'absolute', borderRadius: 999 },
  vein: { position: 'absolute', height: 1 * R, borderRadius: 1 },
});
