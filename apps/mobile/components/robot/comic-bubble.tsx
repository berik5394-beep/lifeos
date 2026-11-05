import React, { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { type LayoutChangeEvent, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { COMIC } from '@/constants/comic';
import { BALLOON_MARGIN, balloonPath, type BalloonTail } from '@/services/comic-balloon';

export type ComicTail = BalloonTail;

/**
 * Облачко реплики как в комиксе: «пухлый» контур с неровностью от руки,
 * хвостик вырастает из самого облачка и указывает на говорящего, жёсткая
 * тень той же формы. Форма — services/comic-balloon (SVG path), под размер текста.
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
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);

  // Seed от размера: у каждого облачка своя неровность, но стабильная между рендерами.
  const d = useMemo(
    () => (size ? balloonPath(size.w, size.h, tail, { seed: Math.round(size.w + size.h) }) : null),
    [size, tail],
  );

  return (
    <View style={[styles.wrap, style]}>
      {size && d && (
        <Svg
          pointerEvents="none"
          style={styles.canvas}
          width={size.w + BALLOON_MARGIN * 2}
          height={size.h + BALLOON_MARGIN * 2}
        >
          <Path d={d} fill={COMIC.ink} transform={`translate(${COMIC.shadow} ${COMIC.shadow})`} />
          <Path d={d} fill={paper} stroke={COMIC.ink} strokeWidth={COMIC.outline} strokeLinejoin="round" />
        </Svg>
      )}
      <View onLayout={onLayout} style={styles.content}>
        {children}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // Поля под выступающий контур облачка (сам контур рисуется за пределами текста).
  wrap: { marginHorizontal: 30, marginVertical: 14 },
  canvas: { position: 'absolute', left: -BALLOON_MARGIN, top: -BALLOON_MARGIN },
  content: { paddingHorizontal: 2, paddingVertical: 2 },
});
