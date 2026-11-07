import React, { memo, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { type DerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import { quadMatrix, roomFaces, type Pt, type RoomFaces } from '@/services/room-geometry';

/**
 * Грань 3D-комнаты: обычный View w×h, натянутый матрицей перспективы на
 * четырёхугольник экрана. Всё внутри (обои, ковёр, окно, свет) ложится по
 * грани. Матрица считается на UI-потоке от «камеры» — параллакс без React.
 */
export const RoomFace = memo(function RoomFace({
  width,
  height,
  sceneW,
  sceneH,
  face,
  cam,
  children,
}: {
  width: number;
  height: number;
  /** Размер сцены — по нему строятся грани. */
  sceneW: number;
  sceneH: number;
  face: keyof RoomFaces;
  /** Сдвиг камеры (пиксели сцены): двигает дальнюю стену. */
  cam: DerivedValue<Pt>;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ matrix: quadMatrix(width, height, roomFaces(sceneW, sceneH, cam.value)[face]) }],
  }));
  return (
    <Animated.View style={[styles.face, { width, height }, style]} pointerEvents="none">
      {children}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  face: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', transformOrigin: [0, 0, 0] },
});
