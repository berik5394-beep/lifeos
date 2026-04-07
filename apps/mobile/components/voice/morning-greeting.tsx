import React, { useEffect, useCallback, useRef } from 'react';
import {
  Animated,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';
import * as Speech from 'expo-speech';
import { colors, spacing, fontSize, borderRadius } from '@/constants';

interface MorningGreetingProps {
  visible: boolean;
  onDismiss: () => void;
  greeting: string;
  onChipPress: (action: string, text: string) => void;
}

interface ChipConfig {
  action: string;
  icon: string;
  label: string;
}

const CHIPS: ChipConfig[] = [
  { action: 'plans_today', icon: '\u{1F4CB}', label: 'Планы на сегодня' },
  { action: 'meetings', icon: '\u{1F4C5}', label: 'Встречи' },
  { action: 'budget', icon: '\u{1F4B0}', label: 'Бюджет' },
  { action: 'motivation', icon: '\u{1F525}', label: 'Мотивация' },
  { action: 'voice_ask', icon: '\u{1F3A4}', label: 'Спросить голосом' },
];

const ChipButton = React.memo(function ChipButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.chip} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.chipText}>
        {icon} {label}
      </Text>
    </TouchableOpacity>
  );
});

function MorningGreetingComponent({
  visible,
  onDismiss,
  greeting,
  onChipPress,
}: MorningGreetingProps) {
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const chipsOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      overlayOpacity.setValue(0);
      contentOpacity.setValue(0);
      chipsOpacity.setValue(0);

      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();

      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 800,
        delay: 200,
        useNativeDriver: true,
      }).start();

      Animated.timing(chipsOpacity, {
        toValue: 1,
        duration: 600,
        delay: 600,
        useNativeDriver: true,
      }).start();

      if (greeting) {
        Speech.speak(greeting, { language: 'ru' });
      }
    } else {
      overlayOpacity.setValue(0);
      contentOpacity.setValue(0);
      chipsOpacity.setValue(0);
    }
  }, [visible, greeting, overlayOpacity, contentOpacity, chipsOpacity]);

  const handleChipPress = useCallback(
    (action: string, text: string) => {
      Speech.stop();
      onChipPress(action, text);
      onDismiss();
    },
    [onChipPress, onDismiss],
  );

  const handleClose = useCallback(() => {
    Speech.stop();
    onDismiss();
  }, [onDismiss]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        {/* Close button */}
        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleClose}
          hitSlop={12}
        >
          <Text style={styles.closeText}>{'\u2715'}</Text>
        </TouchableOpacity>

        {/* Content */}
        <Animated.View style={[styles.content, { opacity: contentOpacity }]}>
          <Text style={styles.greetingText}>{greeting}</Text>
        </Animated.View>

        {/* Chips */}
        <Animated.View style={[styles.chipsContainer, { opacity: chipsOpacity }]}>
          {CHIPS.map((chip) => (
            <ChipButton
              key={chip.action}
              icon={chip.icon}
              label={chip.label}
              onPress={() => handleChipPress(chip.action, chip.label)}
            />
          ))}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export const MorningGreeting = React.memo(MorningGreetingComponent);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
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
  greetingText: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 42,
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
