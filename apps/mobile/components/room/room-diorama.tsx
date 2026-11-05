import React, { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { BACK, FRONT, roomFaces } from '@/services/room-geometry';
import { RoomFace } from './room-face';
import { Wallpaper } from './wallpaper';
import { WallCarpet } from './wall-carpet';
import { RoomWindow } from './room-window';
import { Radiator } from './radiator';
import { WoodFloor } from './wood-floor';
import { CeilingLamp } from './ceiling-lamp';
import { ROOM_PALETTE, RENDER_SCALE as R } from './room-palette';

/** Глубина комнаты в «пикселях текстуры» боковых стен, пола и потолка. */
const DEPTH = 260 * R;

/**
 * Комната робота — 3D-диорама в духе квартиры в СНГ, вид издалека:
 * задняя стена (ковёр, окно со шторами, батарея), боковые стены, потолок с
 * абажуром, деревянный пол. Грани — RoomFace с перспективой.
 */
export const RoomDiorama = memo(function RoomDiorama({
  width,
  height,
  hour,
}: {
  width: number;
  height: number;
  hour: number;
}) {
  const faces = useMemo(() => roomFaces(width, height), [width, height]);
  if (width === 0 || height === 0) return null;
  const bw = (BACK.r - BACK.l) * width;
  const bh = (BACK.b - BACK.t) * height;
  const windowW = bw * 0.36;
  const windowH = bh * 0.42;
  const lit = hour >= 18 || hour < 7;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <RoomFace width={bw} height={DEPTH} quad={faces.ceiling} shade={0.12}>
        <View style={styles.ceiling} />
      </RoomFace>
      <RoomFace width={DEPTH} height={bh} quad={faces.left} shade={0.2}>
        <Wallpaper width={DEPTH} />
      </RoomFace>
      <RoomFace width={DEPTH} height={bh} quad={faces.right} shade={0.14}>
        <Wallpaper width={DEPTH} />
      </RoomFace>
      <RoomFace width={bw} height={DEPTH} quad={faces.floor}>
        <WoodFloor width={bw} height={DEPTH} />
      </RoomFace>
      <RoomFace width={bw} height={bh} quad={faces.back}>
        <Wallpaper width={bw} />
        <View style={[styles.abs, { left: bw * 0.06, top: bh * 0.16 }]}>
          <WallCarpet width={bw * 0.42} height={bh * 0.5} />
        </View>
        <View style={[styles.abs, { left: bw * 0.56, top: bh * 0.12, width: windowW * 1.22, height: windowH + 10 * R }]}>
          <RoomWindow width={windowW} height={windowH} hour={hour} />
        </View>
        <View style={[styles.abs, { left: bw * 0.56 + windowW * 0.21, top: bh * 0.12 + windowH + 14 * R }]}>
          <Radiator width={windowW * 0.8} height={bh * 0.16} />
        </View>
        <View style={[styles.plinth, { top: bh - 5 * R }]} />
      </RoomFace>
      <View style={[styles.lamp, { left: width / 2 - 32 * R, top: ((FRONT.t + BACK.t) / 2) * height - 20 * R }]}>
        <CeilingLamp lit={lit} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  ceiling: { flex: 1, backgroundColor: '#D8CFBD' },
  plinth: { position: 'absolute', left: 0, right: 0, height: 5 * R, backgroundColor: ROOM_PALETTE.plinth },
  lamp: { position: 'absolute', width: 64 * R },
});
