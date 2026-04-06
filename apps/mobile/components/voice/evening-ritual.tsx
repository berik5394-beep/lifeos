import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  FadeIn,
} from 'react-native-reanimated';
import * as Speech from 'expo-speech';
import { ProgressRing } from '@/components/ui';
import { colors, spacing, fontSize, borderRadius } from '@/constants';

interface EveningRitualProps {
  visible: boolean;
  onDismiss: () => void;
  message: string;
  dayProgress: number;
  onChipPress: (action: string) => void;
}

interface ChipConfig {
  action: string;
  icon: string;
  label: string;
  dismissOnPress: boolean;
}

const CHIPS: ChipConfig[] = [
  { action: 'details', icon: '\u{1F4CA}', label: 'Подробнее', dismissOnPress: false },
  { action: 'plan_tomorrow', icon: '\u{1F4DD}', label: 'Спланировать завтра', dismissOnPress: false },
  { action: 'goodnight', icon: '\u{1F319}', label: 'Спокойной ночи', dismissOnPress: true },
];

function EveningRitualComponent({
  visible,
  onDismiss,
  message,
  dayProgress,
  onChipPress,
}: EveningRitualProps) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 600 });
      if (message) {
        Speech.speak(message, { language: 'ru' });
      }
    } else {
      opacity.value = 0;
    }
  }, [visible, message, opacity]);

  const animatedOverlay = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const handleChipPress = useCallback(
    (chip: ChipConfig) => {
      if (chip.dismissOnPress) {
        Speech.stop();
        onDismiss();
      }
      onChipPress(chip.action);
    },
    [onChipPress, onDismiss],
  );

  const handleClose = useCallback(() => {
    Speech.stop();
    onDismiss();
  }, [onDismiss]);

  if (!visible) return null;

  const progressColor =
    dayProgress >= 80
      ? colors.success
      : dayProgress >= 50
        ? colors.warning
        : colors.primary;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Animated.View style={[styles.overlay, animatedOverlay]}>
        {/* Close button */}
        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleClose}
          hitSlop={12}
        >
          <Text style={styles.closeText}>{'\u2715'}</Text>
        </TouchableOpacity>

        {/* Content */}
        <Animated.View entering={FadeIn.duration(800).delay(200)} style={styles.content}>
          {/* Moon icon */}
          <Text style={styles.moonIcon}>{'\u{1F319}'}</Text>

          {/* Progress ring */}
          <View style={styles.progressContainer}>
            <ProgressRing
              progress={dayProgress / 100}
              size={120}
              strokeWidth={8}
              color={progressColor}
            />
            <Text style={styles.progressText}>{Math.round(dayProgress)}%</Text>
          </View>

          {/* Message */}
          <Text style={styles.messageText}>{message}</Text>
        </Animated.View>

        {/* Chips */}
        <Animated.View entering={FadeIn.duration(600).delay(600)} style={styles.chipsContainer}>
          {CHIPS.map((chip) => (
            <TouchableOpacity
              key={chip.action}
              style={styles.chip}
              onPress={() => handleChipPress(chip)}
              activeOpacity={0.7}
            >
              <Text style={styles.chipText}>
                {chip.icon} {chip.label}
              </Text>
            </TouchableOpacity>
          ))}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export const EveningRitual = React.memo(EveningRitualComponent);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 15, 30, 0.97)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: spacing.lg,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  content: {
    alignItems: 'center',
    marginBottom: spacing.xl * 2,
  },
  moonIcon: {
    fontSize: 64,
    marginBottom: spacing.lg,
  },
  progressContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  progressText: {
    position: 'absolute',
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  messageText: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 28,
    paddingHorizontal: spacing.md,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chipText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
});
