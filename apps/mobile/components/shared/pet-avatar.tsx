import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withSpring,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import type { PetType, PetState, PetStage } from '@/stores/pet-store';
import { colors } from '@/constants/colors';

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
  const isDead = state === 'dead';
  const effectiveSize = size ?? (stage ? STAGE_AVATAR_SIZES[stage] : 60);

  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);
  const reactionOpacity = useSharedValue(0);
  const reactionTranslateY = useSharedValue(0);
  const sparkleOpacity = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(translateY);
    cancelAnimation(translateX);
    cancelAnimation(scale);
    cancelAnimation(rotate);
    cancelAnimation(opacity);

    translateY.value = 0;
    translateX.value = 0;
    scale.value = 1;
    rotate.value = 0;
    opacity.value = 1;

    if (isDead) {
      opacity.value = withTiming(0.4, { duration: 500 });
      rotate.value = withTiming(90, { duration: 500 });
      return;
    }

    switch (state) {
      case 'happy':
        translateY.value = withRepeat(
          withSequence(
            withTiming(-8, { duration: 300, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) }),
          ),
          -1,
          true,
        );
        break;
      case 'content':
        translateX.value = withRepeat(
          withSequence(
            withTiming(3, { duration: 800, easing: Easing.inOut(Easing.sin) }),
            withTiming(-3, { duration: 800, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
          true,
        );
        break;
      case 'normal':
        scale.value = withRepeat(
          withSequence(
            withTiming(1.03, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
            withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
          true,
        );
        break;
      case 'sad':
        translateY.value = withTiming(4, { duration: 600, easing: Easing.out(Easing.quad) });
        break;
      case 'sick':
        rotate.value = withTiming(5, { duration: 500 });
        opacity.value = withTiming(0.6, { duration: 500 });
        break;
      case 'hungry':
        translateX.value = withRepeat(
          withSequence(
            withTiming(-4, { duration: 150 }),
            withTiming(4, { duration: 150 }),
            withTiming(-4, { duration: 150 }),
            withTiming(0, { duration: 150 }),
          ),
          -1,
          false,
        );
        break;
      case 'sleepy':
        translateY.value = withRepeat(
          withSequence(
            withTiming(3, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
            withTiming(0, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
          true,
        );
        break;
      case 'sleeping':
        // No animation
        break;
      case 'celebrating':
        translateY.value = withRepeat(
          withSequence(
            withTiming(-12, { duration: 200, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) }),
          ),
          -1,
          true,
        );
        sparkleOpacity.value = withRepeat(
          withSequence(
            withTiming(1, { duration: 300 }),
            withTiming(0, { duration: 300 }),
          ),
          -1,
          true,
        );
        break;
      case 'exercising':
        translateX.value = withRepeat(
          withSequence(
            withTiming(-6, { duration: 200 }),
            withTiming(6, { duration: 200 }),
          ),
          -1,
          true,
        );
        break;
    }
  }, [state, isDead, translateY, translateX, scale, rotate, opacity, sparkleOpacity]);

  useEffect(() => {
    if (!reaction) {
      reactionOpacity.value = withTiming(0, { duration: 200 });
      return;
    }

    reactionTranslateY.value = 0;
    reactionOpacity.value = 1;

    if (reaction === 'jump') {
      translateY.value = withSequence(
        withSpring(-16, { damping: 4, stiffness: 300 }),
        withSpring(0, { damping: 8, stiffness: 200 }),
      );
    } else if (reaction === 'clap') {
      sparkleOpacity.value = withSequence(
        withTiming(1, { duration: 200 }),
        withTiming(0, { duration: 1500 }),
      );
    } else {
      reactionTranslateY.value = withSequence(
        withTiming(-10, { duration: 300 }),
        withTiming(-10, { duration: 1200 }),
        withTiming(-20, { duration: 500 }),
      );
      reactionOpacity.value = withSequence(
        withTiming(1, { duration: 300 }),
        withTiming(1, { duration: 1200 }),
        withTiming(0, { duration: 500 }),
      );
    }
  }, [reaction, translateY, reactionOpacity, reactionTranslateY, sparkleOpacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));

  const reactionStyle = useAnimatedStyle(() => ({
    opacity: reactionOpacity.value,
    transform: [{ translateY: reactionTranslateY.value }],
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    opacity: sparkleOpacity.value,
  }));

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

      <Animated.View style={animatedStyle}>
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
        <Animated.Text style={[styles.sparkle, sparkleStyle, { fontSize: effectiveSize * 0.25 }]}>
          {'\u2728'}
        </Animated.Text>
      ) : null}

      {reaction === 'clap' ? (
        <Animated.Text style={[styles.sparkle, sparkleStyle, { fontSize: effectiveSize * 0.3 }]}>
          {'\u2728'}
        </Animated.Text>
      ) : null}

      {reactionContent && reaction !== 'jump' && reaction !== 'clap' ? (
        <Animated.View style={[styles.reactionBubble, reactionStyle]}>
          <Text style={styles.reactionText}>{reactionContent}</Text>
        </Animated.View>
      ) : null}
    </TouchableOpacity>
  );
};

export const PetAvatar = React.memo(PetAvatarComponent);

const styles = StyleSheet.create({
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
    backgroundColor: colors.surface,
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
