import React, { useEffect, useRef, useMemo } from 'react';
import { Animated, View, Text, TouchableOpacity, StyleSheet, Easing } from 'react-native';
import type { PetType, PetState, PetStage } from '@/stores/pet-store';
import { useColors } from '@/hooks/use-colors';

const PET_EMOJIS: Record<PetType, string> = {
  cat: '\u{1F431}',
  dog: '\u{1F436}',
  fox: '\u{1F98A}',
  owl: '\u{1F989}',
  dragon: '\u{1F409}',
};

const COSTUME_OVERLAYS: Record<string, string> = {
  crown: '\u{1F451}',
  superhero: '\u26A1',
};

const REACTION_EMOJIS: Record<string, string> = {
  thumbsup: '\u{1F44D}',
  headgrab: '\u{1F631}',
  bored: '\u{1F4AD}',
};

const STAGE_AVATAR_SIZES: Record<PetStage, number> = {
  baby: 50,
  teen: 55,
  adult: 60,
  master: 65,
  legend: 70,
};

interface PetAvatarProps {
  petType: PetType;
  state: PetState;
  costume: string | null;
  size?: number;
  onPress?: () => void;
  reaction?: string | null;
  stage?: PetStage;
}

const PetAvatarComponent = ({
  petType,
  state,
  costume,
  size,
  onPress,
  reaction,
  stage,
}: PetAvatarProps) => {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const isDead = state === 'dead';
  const effectiveSize = size ?? (stage ? STAGE_AVATAR_SIZES[stage] : 60);

  const translateY = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const reactionOpacity = useRef(new Animated.Value(0)).current;
  const reactionTranslateY = useRef(new Animated.Value(0)).current;
  const sparkleOpacity = useRef(new Animated.Value(0)).current;

  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    // Stop all running animations
    translateY.stopAnimation();
    translateX.stopAnimation();
    scale.stopAnimation();
    rotate.stopAnimation();
    opacity.stopAnimation();

    // Reset values
    translateY.setValue(0);
    translateX.setValue(0);
    scale.setValue(1);
    rotate.setValue(0);
    opacity.setValue(1);

    if (animationRef.current) {
      animationRef.current.stop();
      animationRef.current = null;
    }

    if (isDead) {
      Animated.timing(opacity, { toValue: 0.4, duration: 500, useNativeDriver: true }).start();
      Animated.timing(rotate, { toValue: 90, duration: 500, useNativeDriver: true }).start();
      return;
    }

    let anim: Animated.CompositeAnimation | null = null;

    switch (state) {
      case 'happy':
        anim = Animated.loop(
          Animated.sequence([
            Animated.timing(translateY, { toValue: -8, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(translateY, { toValue: 0, duration: 300, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ]),
        );
        break;
      case 'content':
        anim = Animated.loop(
          Animated.sequence([
            Animated.timing(translateX, { toValue: 3, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(translateX, { toValue: -3, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
        );
        break;
      case 'normal':
        anim = Animated.loop(
          Animated.sequence([
            Animated.timing(scale, { toValue: 1.03, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(scale, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
        );
        break;
      case 'sad':
        Animated.timing(translateY, { toValue: 4, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
        break;
      case 'sick':
        Animated.timing(rotate, { toValue: 5, duration: 500, useNativeDriver: true }).start();
        Animated.timing(opacity, { toValue: 0.6, duration: 500, useNativeDriver: true }).start();
        break;
      case 'hungry':
        anim = Animated.loop(
          Animated.sequence([
            Animated.timing(translateX, { toValue: -4, duration: 150, useNativeDriver: true }),
            Animated.timing(translateX, { toValue: 4, duration: 150, useNativeDriver: true }),
            Animated.timing(translateX, { toValue: -4, duration: 150, useNativeDriver: true }),
            Animated.timing(translateX, { toValue: 0, duration: 150, useNativeDriver: true }),
          ]),
        );
        break;
      case 'sleepy':
        anim = Animated.loop(
          Animated.sequence([
            Animated.timing(translateY, { toValue: 3, duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(translateY, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
        );
        break;
      case 'sleeping':
        // No animation
        break;
      case 'celebrating': {
        const bounceAnim = Animated.loop(
          Animated.sequence([
            Animated.timing(translateY, { toValue: -12, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(translateY, { toValue: 0, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ]),
        );
        const sparkleAnim = Animated.loop(
          Animated.sequence([
            Animated.timing(sparkleOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
            Animated.timing(sparkleOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
          ]),
        );
        bounceAnim.start();
        sparkleAnim.start();
        animationRef.current = bounceAnim;
        return;
      }
      case 'exercising':
        anim = Animated.loop(
          Animated.sequence([
            Animated.timing(translateX, { toValue: -6, duration: 200, useNativeDriver: true }),
            Animated.timing(translateX, { toValue: 6, duration: 200, useNativeDriver: true }),
          ]),
        );
        break;
    }

    if (anim) {
      anim.start();
      animationRef.current = anim;
    }
  }, [state, isDead, translateY, translateX, scale, rotate, opacity, sparkleOpacity]);

  useEffect(() => {
    if (!reaction) {
      Animated.timing(reactionOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      return;
    }

    reactionTranslateY.setValue(0);
    reactionOpacity.setValue(1);

    if (reaction === 'jump') {
      Animated.sequence([
        Animated.spring(translateY, { toValue: -16, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
      ]).start();
    } else if (reaction === 'clap') {
      Animated.sequence([
        Animated.timing(sparkleOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(sparkleOpacity, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.sequence([
        Animated.timing(reactionTranslateY, { toValue: -10, duration: 300, useNativeDriver: true }),
        Animated.delay(1200),
        Animated.timing(reactionTranslateY, { toValue: -20, duration: 500, useNativeDriver: true }),
      ]).start();
      Animated.sequence([
        Animated.timing(reactionOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.delay(1200),
        Animated.timing(reactionOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]).start();
    }
  }, [reaction, translateY, reactionOpacity, reactionTranslateY, sparkleOpacity]);

  const rotateInterpolation = rotate.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  const emoji = PET_EMOJIS[petType];
  const costumeEmoji = !isDead && costume ? COSTUME_OVERLAYS[costume] : null;
  const reactionContent =
    reaction === 'bored'
      ? '...'
      : reaction
        ? REACTION_EMOJIS[reaction] ?? null
        : null;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
      style={[styles.wrapper, { width: effectiveSize, height: effectiveSize }]}
    >
      {costumeEmoji ? (
        <Text style={[styles.costume, { fontSize: effectiveSize * 0.3, top: -effectiveSize * 0.15 }]}>
          {costumeEmoji}
        </Text>
      ) : null}

      <Animated.View
        style={{
          transform: [
            { translateY },
            { translateX },
            { scale },
            { rotate: rotateInterpolation },
          ],
          opacity,
        }}
      >
        <Text
          style={[
            styles.petEmoji,
            { fontSize: effectiveSize * 0.6 },
            isDead && styles.deadEmoji,
          ]}
        >
          {emoji}
        </Text>
        {isDead ? (
          <Text style={[styles.deadEyes, { fontSize: effectiveSize * 0.2 }]}>
            {'\u2716\uFE0F\u2716\uFE0F'}
          </Text>
        ) : null}
      </Animated.View>

      {state === 'sleeping' && !isDead ? (
        <Text style={[styles.sleepIndicator, { fontSize: effectiveSize * 0.25 }]}>
          {'\u{1F4A4}'}
        </Text>
      ) : null}

      {state === 'celebrating' ? (
        <Animated.Text style={[styles.sparkle, { opacity: sparkleOpacity, fontSize: effectiveSize * 0.25 }]}>
          {'\u2728'}
        </Animated.Text>
      ) : null}

      {reaction === 'clap' ? (
        <Animated.Text style={[styles.sparkle, { opacity: sparkleOpacity, fontSize: effectiveSize * 0.3 }]}>
          {'\u2728'}
        </Animated.Text>
      ) : null}

      {reactionContent && reaction !== 'jump' && reaction !== 'clap' ? (
        <Animated.View style={[styles.reactionBubble, { opacity: reactionOpacity, transform: [{ translateY: reactionTranslateY }] }]}>
          <Text style={styles.reactionText}>{reactionContent}</Text>
        </Animated.View>
      ) : null}
    </TouchableOpacity>
  );
};

export const PetAvatar = React.memo(PetAvatarComponent);

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  petEmoji: {
    textAlign: 'center',
  },
  deadEmoji: {
    opacity: 0.3,
  },
  deadEyes: {
    position: 'absolute',
    textAlign: 'center',
    alignSelf: 'center',
    top: '30%',
  },
  costume: {
    position: 'absolute',
    textAlign: 'center',
    zIndex: 2,
  },
  sleepIndicator: {
    position: 'absolute',
    top: 0,
    right: -4,
  },
  sparkle: {
    position: 'absolute',
    top: -2,
    left: -2,
  },
  reactionBubble: {
    position: 'absolute',
    top: -20,
    backgroundColor: c.surface,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    zIndex: 10,
  },
  reactionText: {
    fontSize: 16,
    textAlign: 'center',
  },
  });
}
