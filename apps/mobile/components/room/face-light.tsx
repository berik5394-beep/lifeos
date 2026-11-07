import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

/** Точка градиента: [доля 0..1, непрозрачность 0..1]. */
export type LightStop = readonly [number, number];

/**
 * Свет и тень на грани комнаты — плавный градиент поверх текстуры (SVG, без
 * нативных модулей). Линейный: вдоль x или y (угол стен темнее, пол светлеет к
 * зрителю). Радиальный: пятно света от окна или абажура.
 */
export const FaceLight = memo(function FaceLight({
  id,
  axis = 'y',
  stops,
  color = '#140C04',
}: {
  /** Уникальный id градиента в пределах экрана. */
  id: string;
  axis?: 'x' | 'y';
  stops: readonly LightStop[];
  color?: string;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2={axis === 'x' ? '1' : '0'} y2={axis === 'y' ? '1' : '0'}>
            {stops.map(([o, a], i) => (
              <Stop key={i} offset={o} stopColor={color} stopOpacity={a} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
});

/** Виньетка: края кадра чуть темнее центра — взгляд уходит вглубь комнаты. */
export const Vignette = memo(function Vignette({ strength = 0.35 }: { strength?: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="roomVignette" cx="0.5" cy="0.55" rx="0.75" ry="0.65" fx="0.5" fy="0.55">
            <Stop offset={0} stopColor="#000000" stopOpacity={0} />
            <Stop offset={0.62} stopColor="#000000" stopOpacity={0} />
            <Stop offset={1} stopColor="#000000" stopOpacity={strength} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#roomVignette)" />
      </Svg>
    </View>
  );
});

/** Мягкое пятно (свет или тень): эллипс с затуханием к краю. Координаты — доли родителя. */
export const SoftSpot = memo(function SoftSpot({
  id,
  cx,
  cy,
  rx,
  ry,
  color,
  opacity,
}: {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  color: string;
  opacity: number;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={id} cx={cx} cy={cy} rx={rx} ry={ry} fx={cx} fy={cy} gradientUnits="objectBoundingBox">
            <Stop offset={0} stopColor={color} stopOpacity={opacity} />
            <Stop offset={0.55} stopColor={color} stopOpacity={opacity * 0.45} />
            <Stop offset={1} stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
});
