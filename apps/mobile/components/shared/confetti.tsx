import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, View, StyleSheet, Dimensions, Easing } from 'react-native';
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
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      progress.setValue(0);
      opacity.setValue(0);

      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        delay: config.delay,
        useNativeDriver: true,
      }).start();

      Animated.timing(progress, {
        toValue: 1,
        duration: config.fallDuration,
        delay: config.delay,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start();
    } else {
      opacity.setValue(0);
      progress.setValue(0);
    }
  }, [visible, config.delay, config.fallDuration, progress, opacity]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-20, SCREEN_HEIGHT + 20],
  });

  const translateX = progress.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [
      0,
      config.wobbleAmplitude,
      0,
      -config.wobbleAmplitude,
      0,
    ],
  });

  const rotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

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
          opacity,
          transform: [
            { translateY },
            { translateX },
            { rotate },
          ],
        },
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
