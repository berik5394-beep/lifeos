import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type DerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import { BACK, type Pt } from '@/services/room-geometry';
import { RoomFace } from './room-face';
import { FaceLight, SoftSpot } from './face-light';
import { Wallpaper } from './wallpaper';
import { WallCarpet } from './wall-carpet';
import { RoomWindow } from './room-window';
import { Radiator } from './radiator';
import { WoodFloor } from './wood-floor';
import { CeilingLamp } from './ceiling-lamp';
import { ROOM_PALETTE, RENDER_SCALE as R } from './room-palette';
import type { RoomTier } from '@/services/room-catalog';

/** Глубина комнаты в «пикселях текстуры» боковых стен, пола и потолка. */
const DEPTH = 260 * R;
/** Абажур висит на этой глубине (0 — край экрана, 1 — задняя стена). */
const LAMP_DEPTH = 0.62;

/**
 * Комната робота — 3D-диорама в духе квартиры в СНГ на весь экран: задняя
 * стена (ковёр, окно со шторами, батарея), боковые стены, потолок с абажуром,
 * деревянный пол. Грани — RoomFace с перспективой; объём дают свет и тени:
 * углы и стыки темнее, днём из окна на пол падает свет, вечером — от абажура,
 * потолок темнеет к краю экрана.
 */
export const RoomDiorama = memo(function RoomDiorama({
  width,
  height,
  hour,
  cam,
  wallsTier = null,
  floorTier = null,
}: {
  width: number;
  height: number;
  hour: number;
  /** Сдвиг камеры (пиксели сцены): поворот головы робота, наклон телефона. */
  cam: DerivedValue<Pt>;
  /** Часть 6: купленная отделка стен/пола (null — исходная комната). */
  wallsTier?: RoomTier | null;
  floorTier?: RoomTier | null;
}) {
  const lampStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cam.value.x * LAMP_DEPTH }, { translateY: cam.value.y * LAMP_DEPTH }],
  }));
  if (width === 0 || height === 0) return null;
  const bw = (BACK.r - BACK.l) * width;
  const bh = (BACK.b - BACK.t) * height;
  const windowW = bw * 0.36;
  const windowH = bh * 0.42;
  const lit = hour >= 18 || hour < 7;
  const day = hour >= 7 && hour < 18;
  const face = { sceneW: width, sceneH: height, cam };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <RoomFace {...face} face="ceiling" width={bw} height={DEPTH}>
        <View style={styles.ceiling} />
        <View style={[styles.cornice, styles.bottomEdge]} />
        {/* Потолок темнеет к краю экрана — свет в глубине комнаты. */}
        <FaceLight id="ceil" stops={[[0, 0.62], [0.55, 0.3], [1, 0.08]]} />
      </RoomFace>
      <RoomFace {...face} face="left" width={DEPTH} height={bh}>
        <Wallpaper width={DEPTH} tier={wallsTier} />
        <View style={[styles.cornice, styles.topEdge]} />
        <View style={[styles.plinth, styles.bottomEdge]} />
        <FaceLight id="leftX" axis="x" stops={[[0, 0.46], [0.6, 0.22], [0.92, 0.2], [1, 0.42]]} />
        <FaceLight id="leftY" stops={[[0, 0.22], [0.12, 0], [0.86, 0], [1, 0.3]]} />
      </RoomFace>
      <RoomFace {...face} face="right" width={DEPTH} height={bh}>
        <Wallpaper width={DEPTH} tier={wallsTier} />
        <View style={[styles.cornice, styles.topEdge]} />
        <View style={[styles.plinth, styles.bottomEdge]} />
        <FaceLight id="rightX" axis="x" stops={[[0, 0.46], [0.08, 0.26], [0.4, 0.28], [1, 0.52]]} />
        <FaceLight id="rightY" stops={[[0, 0.22], [0.12, 0], [0.86, 0], [1, 0.3]]} />
      </RoomFace>
      <RoomFace {...face} face="floor" width={bw} height={DEPTH}>
        <WoodFloor width={bw} height={DEPTH} tier={floorTier} />
        {day && <SoftSpot id="sun" cx={0.6} cy={0.32} rx={0.3} ry={0.42} color="#FFE7B0" opacity={0.3} />}
        {lit && <SoftSpot id="lampPool" cx={0.5} cy={0.42} rx={0.5} ry={0.5} color="#FFC878" opacity={0.28} />}
        {/* Стык с задней стеной темнее, края пола — в полутени. */}
        <FaceLight id="floorY" stops={[[0, 0.5], [0.1, 0.18], [0.55, 0.04], [1, 0.22]]} />
        <FaceLight id="floorX" axis="x" stops={[[0, 0.32], [0.16, 0.04], [0.84, 0.04], [1, 0.36]]} />
      </RoomFace>
      <RoomFace {...face} face="back" width={bw} height={bh}>
        <Wallpaper width={bw} tier={wallsTier} />
        {day && <SoftSpot id="glow" cx={0.67} cy={0.33} rx={0.42} ry={0.42} color="#FFF4D6" opacity={0.28} />}
        <View style={[styles.cornice, styles.topEdge]} />
        <View style={[styles.carpetShadow, { left: bw * 0.06 + 4 * R, top: bh * 0.16 + 6 * R, width: bw * 0.42, height: bh * 0.5 }]} />
        <View style={[styles.abs, { left: bw * 0.06, top: bh * 0.16 }]}>
          <WallCarpet width={bw * 0.42} height={bh * 0.5} />
        </View>
        <View style={[styles.abs, { left: bw * 0.56, top: bh * 0.12, width: windowW * 1.22, height: windowH + 10 * R }]}>
          <RoomWindow width={windowW} height={windowH} hour={hour} />
        </View>
        <View
          style={[
            styles.radiatorShadow,
            { left: bw * 0.56 + windowW * 0.21 + 3 * R, top: bh * 0.12 + windowH + 18 * R, width: windowW * 0.8, height: bh * 0.16 },
          ]}
        />
        <View style={[styles.abs, { left: bw * 0.56 + windowW * 0.21, top: bh * 0.12 + windowH + 14 * R }]}>
          <Radiator width={windowW * 0.8} height={bh * 0.16} />
        </View>
        <View style={[styles.plinth, { top: bh - 5 * R }]} />
        <FaceLight id="backX" axis="x" stops={[[0, 0.26], [0.07, 0.06], [0.93, 0.06], [1, 0.3]]} />
        <FaceLight id="backY" stops={[[0, 0.2], [0.08, 0.02], [0.86, 0.02], [1, 0.24]]} />
      </RoomFace>
      <Animated.View
        style={[styles.lamp, { left: width / 2 - 32 * R, top: BACK.t * LAMP_DEPTH * height }, lampStyle]}
      >
        <CeilingLamp lit={lit} />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  ceiling: { flex: 1, backgroundColor: '#D8CFBD' },
  topEdge: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomEdge: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  // Карниз под потолком и плинтус у пола — по всем стенам, чтобы стыки читались.
  cornice: { height: 4 * R, backgroundColor: '#E9E1D0' },
  plinth: { position: 'absolute', left: 0, right: 0, height: 5 * R, backgroundColor: ROOM_PALETTE.plinth },
  carpetShadow: { position: 'absolute', borderRadius: 2 * R, backgroundColor: 'rgba(30,15,5,0.28)' },
  radiatorShadow: { position: 'absolute', borderRadius: 3 * R, backgroundColor: 'rgba(30,15,5,0.22)' },
  lamp: { position: 'absolute', width: 64 * R },
});
