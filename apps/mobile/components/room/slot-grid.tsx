import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type DerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import { RENDER_SCALE as R, itemDepthScale, pointDepth, type Pt } from '@/services/room-geometry';
import { SLOT_POS, type OwnedItem, type PlaceSlot, type RoomSpot } from '@/services/room-catalog';

const BOX = 60 * R;

/**
 * Робот-эпик, Часть 6: ячейки комнаты — чёткие боксы, в каждом один предмет.
 * Видны, пока обставляешь или тащишь предмет; подходящие для тащимого —
 * ярче, свободные — пунктиром.
 */
export const SlotGrid = memo(function SlotGrid({
  width,
  height,
  owned,
  dragSpot,
  cam,
}: {
  width: number;
  height: number;
  owned: OwnedItem[];
  /** Тащим предмет этого типа — его ячейки ярче. null — просто обставляем. */
  dragSpot: RoomSpot | null;
  /** Камера комнаты: ячейка сдвигается вместе с предметом в ней. */
  cam: DerivedValue<Pt>;
}) {
  const taken = new Set(owned.map((o) => o.slot));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {(Object.keys(SLOT_POS) as PlaceSlot[]).map((slot) => {
        const p = SLOT_POS[slot];
        const spot: RoomSpot = slot.startsWith('wall') ? 'wall' : 'floor';
        const s = BOX * itemDepthScale(p.y);
        const active = dragSpot === null || dragSpot === spot;
        return (
          <SlotBox
            key={slot}
            depth={pointDepth(p.x, p.y)}
            cam={cam}
            style={{
              left: p.x * width - s / 2,
              top: p.y * height - s / 2,
              width: s,
              height: s,
              opacity: active ? 1 : 0.25,
              borderStyle: taken.has(slot) ? 'solid' : 'dashed',
              borderColor: dragSpot && active ? '#FDE68A' : 'rgba(255,255,255,0.75)',
            }}
          />
        );
      })}
    </View>
  );
});

function SlotBox({
  depth,
  cam,
  style,
}: {
  depth: number;
  cam: DerivedValue<Pt>;
  style: {
    left: number;
    top: number;
    width: number;
    height: number;
    opacity: number;
    borderStyle: 'solid' | 'dashed';
    borderColor: string;
  };
}) {
  const shift = useAnimatedStyle(() => ({
    transform: [{ translateX: cam.value.x * depth }, { translateY: cam.value.y * depth }],
  }));
  return <Animated.View style={[styles.box, style, shift]} />;
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderWidth: 2 * R,
    borderRadius: 10 * R,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
