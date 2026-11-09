import React, { memo, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { type DerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import { faceWeight, quadMatrix, roomFaces, type FaceName, type RoomCam } from '@/services/room-geometry';

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
  face: FaceName;
  /** Камера: сдвиг (двигает дальнюю стену) и поворот (куда смотрим). */
  cam: DerivedValue<RoomCam>;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    // Стена за спиной гаснет (и прижата к краю экрана) — не закрывает комнату.
    const w = faceWeight(face, cam.value.turn ?? 0);
    return {
      opacity: w,
      transform: [{ matrix: quadMatrix(width, height, roomFaces(sceneW, sceneH, cam.value)[face]) }],
    };
  });
  return (
    <Animated.View style={[styles.face, { width, height }, style]} pointerEvents="none">
      {children}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  face: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', transformOrigin: [0, 0, 0] },
});
