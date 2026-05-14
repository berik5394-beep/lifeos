import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { spacing, borderRadius, fontSize } from '@/constants';
import type { Theme } from '@/constants/themes';

interface PomodoroTimerProps {
  totalSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  isBreak: boolean;
  onToggle: () => void;
  onReset: () => void;
  onSkip?: () => void;
}

const createStyles = (c: Theme, isBreak: boolean, progress: number) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    ring: {
      width: 220,
      height: 220,
      borderRadius: 110,
      borderWidth: 8,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    progressRing: {
      position: 'absolute',
      top: -8,
      left: -8,
      width: 220,
      height: 220,
      borderRadius: 110,
      borderWidth: 8,
      borderColor: 'transparent',
      borderTopColor: isBreak ? c.success : c.primary,
      borderRightColor: progress > 0.25 ? (isBreak ? c.success : c.primary) : 'transparent',
      borderBottomColor: progress > 0.5 ? (isBreak ? c.success : c.primary) : 'transparent',
      borderLeftColor: progress > 0.75 ? (isBreak ? c.success : c.primary) : 'transparent',
      transform: [{ rotate: '-90deg' }],
    },
    timeText: {
      fontSize: 48,
      fontWeight: '700',
      color: c.text,
    },
    label: {
      fontSize: fontSize.sm,
      color: isBreak ? c.success : c.primary,
      fontWeight: '600',
      marginTop: spacing.xs,
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.lg,
      gap: spacing.md,
    },
    controlButton: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    playButton: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: isBreak ? c.success : c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

export const PomodoroTimer = React.memo(function PomodoroTimer({
  totalSeconds,
  remainingSeconds,
  isRunning,
  isBreak,
  onToggle,
  onReset,
  onSkip,
}: PomodoroTimerProps) {
  const c = useColors();
  const progress = totalSeconds > 0 ? 1 - remainingSeconds / totalSeconds : 0;
  const styles = useMemo(() => createStyles(c, isBreak, progress), [c, isBreak, progress]);

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <View style={styles.container}>
      <View style={styles.ring}>
        <View style={styles.progressRing} />
        <Text style={styles.timeText}>{timeStr}</Text>
        <Text style={styles.label}>{isBreak ? 'Перерыв' : 'Фокус'}</Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={onReset}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Сбросить таймер"
        >
          <Feather name="rotate-ccw" size={22} color={c.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.playButton}
          onPress={onToggle}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={isRunning ? 'Пауза' : 'Запустить таймер'}
        >
          <Feather name={isRunning ? 'pause' : 'play'} size={28} color="#fff" />
        </TouchableOpacity>

        {onSkip && (
          <TouchableOpacity
            style={styles.controlButton}
            onPress={onSkip}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Пропустить"
          >
            <Feather name="skip-forward" size={22} color={c.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});
