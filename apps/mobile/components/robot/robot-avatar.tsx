import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { ROBOT_COLORS, eyeShapeFor, type EyeBox, type RobotEmotion } from '@/services/robot-emotion';

/**
 * Робот-компаньон — «тело» единого мозга (робот-эпик, Часть 2). Геометрия и
 * поведение — 1:1 с прототипом Berik (robot_companion.html): капсула-голова,
 * тёмный экран-лицо, вся мимика через глаза; дыхание, моргание, пульс антенны.
 * Эмоцию присылает сервер, компонент только рисует.
 *
 * Рисуется в базовых координатах 150×206 и масштабируется под `size` (высота).
 */
export type RobotAttention = 'idle' | 'listening' | 'reacting';

interface RobotAvatarProps {
  emotion: RobotEmotion;
  /** Высота робота в pt (базовая 206). */
  size?: number;
  /** listening — юзер пишет/говорит: робот чуть уменьшается и слушает. */
  attention?: RobotAttention;
  /** Поворот головы: −1 влево, 0 прямо, +1 вправо (комната, Часть 4). */
  headTurn?: -1 | 0 | 1;
}

const BASE_W = 150;
const BASE_H = 206;
const SPRING = { damping: 11, stiffness: 160, mass: 0.7 };

function Eye({ shape, side, blink }: { shape: ReturnType<typeof eyeShapeFor>; side: 'left' | 'right'; blink: SharedValue<number> }) {
  const target: EyeBox = side === 'left' ? shape.left : shape.right;
  const w = useSharedValue(target.width);
  const h = useSharedValue(target.height);
  const rt = useSharedValue(target.radiusTop);
  const rb = useSharedValue(target.radiusBottom);
  const shake = useSharedValue(0);

  useEffect(() => {
    w.value = withSpring(target.width, SPRING);
    h.value = withSpring(target.height, SPRING);
    rt.value = withTiming(target.radiusTop, { duration: 280 });
    rb.value = withTiming(target.radiusBottom, { duration: 280 });
    if (shape.tremble) {
      shake.value = withRepeat(withSequence(withTiming(-0.6, { duration: 60 }), withTiming(0.6, { duration: 60 })), -1, true);
    } else {
      cancelAnimation(shake);
      shake.value = withTiming(0, { duration: 80 });
    }
  }, [target.width, target.height, target.radiusTop, target.radiusBottom, shape.tremble, w, h, rt, rb, shake]);

  const eyeStyle = useAnimatedStyle(() => {
    const blinking = blink.value > 0.5;
    return {
      width: w.value,
      height: blinking ? 3 : h.value,
      borderTopLeftRadius: blinking ? 3 : rt.value,
      borderTopRightRadius: blinking ? 3 : rt.value,
      borderBottomLeftRadius: blinking ? 3 : rb.value,
      borderBottomRightRadius: blinking ? 3 : rb.value,
      transform: [{ translateX: shake.value }],
    };
  });

  // Бровь/веко: тёмная полоса цвета экрана, наклонённая внутренним краем.
  const browRotate = side === 'left' ? shape.browAngle : -shape.browAngle;

  return (
    <Animated.View
      style={[
        styles.eye,
        { backgroundColor: shape.color, shadowColor: shape.color, opacity: shape.opacity },
        eyeStyle,
      ]}
    >
      {shape.highlight ? <View style={styles.highlight} /> : null}
      {shape.browAngle !== 0 ? (
        <View style={[styles.brow, { transform: [{ rotate: `${browRotate}deg` }] }]} />
      ) : null}
    </Animated.View>
  );
}

export const RobotAvatar = memo(function RobotAvatar({
  emotion,
  size = BASE_H,
  attention = 'idle',
  headTurn = 0,
}: RobotAvatarProps) {
  const shape = eyeShapeFor(emotion);
  const scale = size / BASE_H;

  const breathe = useSharedValue(0);
  const bulb = useSharedValue(1);
  const blink = useSharedValue(0);
  const tilt = useSharedValue(0);
  const attn = useSharedValue(1);
  const head = useSharedValue(0);
  const wave = useSharedValue(0);
  const pulse = useSharedValue(1);

  // Постоянная жизнь: дыхание, пульс антенны, моргание раз в 3–6 с.
  useEffect(() => {
    breathe.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
    bulb.value = withRepeat(withSequence(withTiming(0.4, { duration: 900 }), withTiming(1, { duration: 900 })), -1);
    let timer: ReturnType<typeof setTimeout>;
    const scheduleBlink = () => {
      timer = setTimeout(() => {
        blink.value = withSequence(withTiming(1, { duration: 60 }), withDelay(110, withTiming(0, { duration: 60 })));
        scheduleBlink();
      }, 3000 + Math.random() * 3000);
    };
    scheduleBlink();
    return () => {
      clearTimeout(timer);
      cancelAnimation(breathe);
      cancelAnimation(bulb);
    };
  }, [breathe, bulb, blink]);

  useEffect(() => {
    tilt.value = withSpring(shape.tilt, SPRING);
    if (shape.wave) {
      wave.value = withRepeat(withSequence(withTiming(-30, { duration: 250 }), withTiming(0, { duration: 250 })), 3);
    }
    if (shape.pulse) {
      pulse.value = withRepeat(withSequence(withTiming(1.08, { duration: 500 }), withTiming(1, { duration: 500 })), -1);
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 150 });
    }
  }, [emotion, shape.tilt, shape.wave, shape.pulse, tilt, wave, pulse]);

  useEffect(() => {
    attn.value = withSpring(attention === 'listening' ? 0.74 : 1, SPRING);
  }, [attention, attn]);

  useEffect(() => {
    head.value = withSpring(headTurn * 13, SPRING);
  }, [headTurn, head]);

  const rootStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: breathe.value + (1 - attn.value) * 30 },
      { scale: attn.value },
      { rotate: `${tilt.value}deg` },
    ],
  }));
  const bulbStyle = useAnimatedStyle(() => ({ opacity: bulb.value }));
  const headStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${head.value}deg` }] }));
  const eyesStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shape.offsetX }, { translateY: shape.offsetY }, { scale: pulse.value }],
  }));
  const rightArmStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-28 + wave.value}deg` }] }));

  return (
    <View style={{ width: BASE_W * scale, height: BASE_H * scale }} accessibilityLabel="Робот-компаньон">
      <View style={[styles.stage, { transform: [{ scale }] }]}>
        <Animated.View style={[styles.robot, rootStyle]}>
          <View style={styles.antenna} />
          <Animated.View style={[styles.bulb, bulbStyle]} />
          <View style={styles.body}>
            <View style={styles.led} />
          </View>
          <View style={[styles.arm, styles.armLeft]}>
            <View style={styles.hand} />
          </View>
          <Animated.View style={[styles.arm, styles.armRight, rightArmStyle]}>
            <View style={styles.hand} />
          </Animated.View>
          <Animated.View style={[styles.head, headStyle]}>
            <View style={styles.screen}>
              <Animated.View style={[styles.eyes, eyesStyle]}>
                <Eye shape={shape} side="left" blink={blink} />
                <Eye shape={shape} side="right" blink={blink} />
              </Animated.View>
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  stage: {
    width: BASE_W,
    height: BASE_H,
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: 'top left',
  },
  robot: { width: BASE_W, height: BASE_H, transformOrigin: 'bottom' },
  antenna: {
    position: 'absolute',
    left: BASE_W / 2 - 2,
    top: 10,
    width: 4,
    height: 22,
    borderRadius: 2,
    backgroundColor: ROBOT_COLORS.antenna,
  },
  bulb: {
    position: 'absolute',
    left: BASE_W / 2 - 6.5,
    top: 0,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: ROBOT_COLORS.accent,
    shadowColor: ROBOT_COLORS.accent,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  head: {
    position: 'absolute',
    left: (BASE_W - 132) / 2,
    top: 30,
    width: 132,
    height: 108,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: ROBOT_COLORS.shellBorder,
    backgroundColor: ROBOT_COLORS.shell,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    transformOrigin: '50% 85%',
  },
  screen: {
    width: 106,
    height: 78,
    borderRadius: 18,
    backgroundColor: ROBOT_COLORS.screen,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  eyes: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  eye: {
    overflow: 'hidden',
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  highlight: {
    position: 'absolute',
    top: 5,
    left: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  brow: {
    position: 'absolute',
    left: -7,
    right: -7,
    top: '-44%',
    height: '88%',
    backgroundColor: ROBOT_COLORS.screen,
  },
  body: {
    position: 'absolute',
    left: (BASE_W - 86) / 2,
    bottom: 0,
    width: 86,
    height: 64,
    borderRadius: 20,
    backgroundColor: ROBOT_COLORS.body,
    alignItems: 'center',
    justifyContent: 'center',
  },
  led: { width: 13, height: 13, borderRadius: 6.5, backgroundColor: ROBOT_COLORS.accent },
  arm: {
    position: 'absolute',
    bottom: 44,
    width: 8,
    height: 34,
    borderRadius: 6,
    backgroundColor: ROBOT_COLORS.arm,
    transformOrigin: 'top',
    zIndex: 2,
  },
  armLeft: { left: 16, transform: [{ rotate: '28deg' }] },
  armRight: { right: 16 },
  hand: {
    position: 'absolute',
    bottom: -6,
    left: -2.5,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: ROBOT_COLORS.shell,
  },
});
