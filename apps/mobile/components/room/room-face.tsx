import React, { memo, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { quadMatrix, type Quad } from '@/services/room-geometry';

/**
 * Грань 3D-комнаты: обычный View w×h, натянутый матрицей перспективы на
 * четырёхугольник экрана. Всё внутри (обои, ковёр, окно) ложится по грани.
 */
export const RoomFace = memo(function RoomFace({
  width,
  height,
  quad,
  shade = 0,
  children,
}: {
  width: number;
  height: number;
  quad: Quad;
  /** Затемнение грани 0..1 — боковые стены и потолок темнее задней стены. */
  shade?: number;
  children: ReactNode;
}) {
  const transform = useMemo(() => [{ matrix: quadMatrix(width, height, quad) }], [width, height, quad]);
  return (
    <View style={[styles.face, { width, height, transform }]} pointerEvents="none">
      {children}
      {shade > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(20,12,4,${shade})` }]} />}
    </View>
  );
});

const styles = StyleSheet.create({
  face: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', transformOrigin: [0, 0, 0] },
});
