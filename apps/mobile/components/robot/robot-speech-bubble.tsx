import React, { memo, useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { ComicBubble } from './comic-bubble';
import { ComicText } from './comic-text';

/** Реплика робота в комнате (благодарность за предмет): комиксовое облачко, текст печатается. */
export const RobotSpeechBubble = memo(function RobotSpeechBubble({ text }: { text: string }) {
  const appear = useSharedValue(0);

  useEffect(() => {
    appear.value = 0;
    appear.value = withSpring(1, { damping: 9, stiffness: 180 });
  }, [text, appear]);

  // «Выпрыгивает» с лёгким перекосом, как облачко в комиксе.
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, appear.value * 1.5),
    transform: [{ scale: 0.6 + appear.value * 0.4 }, { rotate: `${(1 - appear.value) * -6 - 1.5}deg` }],
  }));

  return (
    <Animated.View style={style} pointerEvents="none" accessibilityLiveRegion="polite">
      <ComicBubble tail="bottom-left">
        <ComicText text={text} typewrite />
      </ComicBubble>
    </Animated.View>
  );
});
