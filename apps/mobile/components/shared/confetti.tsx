import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { colors } from '@/constants';

interface ConfettiProps {
  visible: boolean;
  onComplete?: () => void;
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const PARTICLE_COUNT = 35;
const CONFETTI_COLORS = [
  colors.primary,
  colors.success,
  colors.warning,
  colors.secondary,
  colors.danger,
];

interface ParticleConfig {
  startX: number;
  delay: number;
  fallDuration: number;
  color: string;
  size: number;
  wobbleAmplitude: number;
}

function generateParticles(): ParticleConfig[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    startX: Math.random() * SCREEN_WIDTH,
    delay: Math.random() * 500,
    fallDuration: 2000 + Math.random() * 1500,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    size: 6 + Math.random() * 4,
    wobbleAmplitude: 20 + Math.random() * 40,
  }));
}

const Particle = React.memo(function Particle({
  config,
  visible,
}: {
  config: ParticleConfig;
  visible: boolean;
}) {
  const translateY = useSharedValue(-20);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = -20;
      opacity.value = 0;
      translateY.value = withDelay(
        config.delay,
        withTiming(SCREEN_HEIGHT + 20, {
          duration: config.fallDuration,
          easing: Easing.in(Easing.quad),
        }),
      );
      opacity.value = withDelay(
        config.delay,
        withTiming(1, { duration: 200 }),
      );
    } else {
      opacity.value = 0;
      translateY.value = -20;
    }
  }, [visible, config.delay, config.fallDuration, translateY, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      {
        translateX:
          Math.sin(translateY.value / 50) * config.wobbleAmplitude,
      },
      { rotate: `${(translateY.value / SCREEN_HEIGHT) * 360}deg` },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          left: config.startX,
          width: config.size,
          height: config.size,
          backgroundColor: config.color,
          borderRadius: config.size / 2,
        },
        animatedStyle,
      ]}
    />
  );
});

export const Confetti = React.memo(function Confetti({
  visible,
  onComplete,
}: ConfettiProps) {
  const particles = useMemo(() => generateParticles(), []);

  useEffect(() => {
    if (visible && onComplete) {
      const timeout = setTimeout(() => {
        onComplete();
      }, 3500);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [visible, onComplete]);

  if (!visible) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      {particles.map((config, index) => (
        <Particle key={index} config={config} visible={visible} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
  },
  particle: {
    position: 'absolute',
    top: 0,
  },
});
