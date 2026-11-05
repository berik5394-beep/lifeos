import React, { memo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { COMIC } from '@/constants/comic';

export type ComicTail = 'bottom-left' | 'left' | 'right' | 'none';

/**
 * Облачко реплики в стиле комикса: белая «бумага», жирный чёрный контур,
 * жёсткая тень-подложка и хвостик с контуром, указывающий на говорящего.
 */
export const ComicBubble = memo(function ComicBubble({
  children,
  tail = 'bottom-left',
  paper = COMIC.paper,
  style,
}: {
  children: ReactNode;
  tail?: ComicTail;
  /** Цвет «бумаги»: у робота белый, у юзера — свой (COMIC.userPaper). */
  paper?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.shadow} />
      <View style={[styles.paper, { backgroundColor: paper }]}>{children}</View>
      {tail === 'bottom-left' && (
        <>
          <View style={[styles.tailDownOuter]} />
          <View style={[styles.tailDownInner, { borderTopColor: paper }]} />
        </>
      )}
      {tail === 'left' && (
        <>
          <View style={[styles.tailLeftOuter]} />
          <View style={[styles.tailLeftInner, { borderRightColor: paper }]} />
        </>
      )}
      {tail === 'right' && (
        <>
          <View style={styles.tailRightOuter} />
          <View style={[styles.tailRightInner, { borderLeftColor: paper }]} />
        </>
      )}
    </View>
  );
});

const T = 14; // половина ширины основания хвостика
const L = 18; // длина хвостика
const o = COMIC.outline;

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  shadow: {
    ...StyleSheet.absoluteFillObject,
    top: COMIC.shadow,
    left: COMIC.shadow,
    right: -COMIC.shadow,
    bottom: -COMIC.shadow,
    borderRadius: 26,
    backgroundColor: COMIC.ink,
  },
  paper: {
    backgroundColor: COMIC.paper,
    borderWidth: o,
    borderColor: COMIC.ink,
    borderRadius: 26,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  // Хвостик вниз: чёрный треугольник + белый поверх, перекрывающий линию контура.
  tailDownOuter: {
    position: 'absolute',
    left: 30,
    bottom: -L + 1,
    width: 0,
    height: 0,
    borderLeftWidth: T,
    borderRightWidth: 0,
    borderTopWidth: L,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: COMIC.ink,
  },
  tailDownInner: {
    position: 'absolute',
    left: 30 + o + 1,
    bottom: -L + 1 + o + 2,
    width: 0,
    height: 0,
    borderLeftWidth: T - o - 2,
    borderTopWidth: L - o - 2,
    borderLeftColor: 'transparent',
    borderTopColor: COMIC.paper,
  },
  // Хвостик влево (к аватару в чате).
  tailLeftOuter: {
    position: 'absolute',
    left: -L + 1,
    top: 14,
    width: 0,
    height: 0,
    borderTopWidth: 0,
    borderBottomWidth: T,
    borderRightWidth: L,
    borderBottomColor: 'transparent',
    borderRightColor: COMIC.ink,
  },
  tailLeftInner: {
    position: 'absolute',
    left: -L + 1 + o + 2,
    top: 14 + o,
    width: 0,
    height: 0,
    borderBottomWidth: T - o - 2,
    borderRightWidth: L - o - 2,
    borderBottomColor: 'transparent',
    borderRightColor: COMIC.paper,
  },
  // Хвостик вправо (к юзеру, к краю экрана).
  tailRightOuter: {
    position: 'absolute',
    right: -L + 1,
    top: 14,
    width: 0,
    height: 0,
    borderBottomWidth: T,
    borderLeftWidth: L,
    borderBottomColor: 'transparent',
    borderLeftColor: COMIC.ink,
  },
  tailRightInner: {
    position: 'absolute',
    right: -L + 1 + o + 2,
    top: 14 + o,
    width: 0,
    height: 0,
    borderBottomWidth: T - o - 2,
    borderLeftWidth: L - o - 2,
    borderBottomColor: 'transparent',
    borderLeftColor: COMIC.paper,
  },
});
