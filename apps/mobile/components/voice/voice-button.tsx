import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  ActivityIndicator,
  Easing,
  Pressable,
  View,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { getColors } from '@/hooks/use-colors';

export interface VoiceButtonProps {
  /**
   * Fires on tap release (tap mode). If `onPressIn` is provided, this is
   * optional and usually left out — hold mode handles start/stop via
   * onPressIn/onPressOut instead.
   */
  onPress?: () => void;
  /** Hold mode: fires when finger touches the button. Use to START recording. */
  onPressIn?: () => void;
  /** Hold mode: fires when finger lifts. Use to STOP recording & process. */
  onPressOut?: () => void;
  /** Current recording flag (from useVoice) */
  isRecording: boolean;
  /** Current processing flag (from useVoice) */
  isProcessing: boolean;
  /**
   * Optional RMS amplitude 0..1 from useVoice. When provided, the outer ring
   * scales responsively to the user's voice for live feedback.
   */
  amplitude?: number;
  /** Optional size override (default 64) */
  size?: number;
  style?: ViewStyle;
}

const DEFAULT_SIZE = 68;

/**
 * LifeOS Voice FAB — v2
 *
 * - Layered visuals: outer pulse ring + mid glow halo + inner button
 * - Outer ring scales with live amplitude when recording
 * - Smooth entry/exit transitions (no abrupt snaps)
 * - Disabled state during processing with spinner
 */
export const VoiceButton = React.memo(function VoiceButton({
  onPress,
  onPressIn: externalPressIn,
  onPressOut: externalPressOut,
  isRecording,
  isProcessing,
  amplitude = 0,
  size = DEFAULT_SIZE,
  style,
}: VoiceButtonProps) {
  // Inner button scale (subtle pulse when recording)
  const innerScale = useRef(new Animated.Value(1)).current;
  // Outer ripple ring
  const rippleScale = useRef(new Animated.Value(1)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;
  // Amplitude-responsive halo
  const haloScale = useRef(new Animated.Value(1)).current;
  // Press feedback
  const pressScale = useRef(new Animated.Value(1)).current;

  const innerLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const rippleLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Pulse + ripple when recording
  useEffect(() => {
    if (isRecording) {
      const innerAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(innerScale, {
            toValue: 1.08,
            duration: 600,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(innerScale, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      innerLoopRef.current = innerAnim;
      innerAnim.start();

      const rippleAnim = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(rippleScale, {
              toValue: 1.9,
              duration: 1400,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.sequence([
              Animated.timing(rippleOpacity, {
                toValue: 0.45,
                duration: 100,
                useNativeDriver: true,
              }),
              Animated.timing(rippleOpacity, {
                toValue: 0,
                duration: 1300,
                useNativeDriver: true,
              }),
            ]),
          ]),
          Animated.timing(rippleScale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      );
      rippleLoopRef.current = rippleAnim;
      rippleAnim.start();
    } else {
      innerLoopRef.current?.stop();
      rippleLoopRef.current?.stop();
      innerLoopRef.current = null;
      rippleLoopRef.current = null;
      Animated.parallel([
        Animated.timing(innerScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(rippleOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
      rippleScale.setValue(1);
    }
    return () => {
      innerLoopRef.current?.stop();
      rippleLoopRef.current?.stop();
    };
  }, [isRecording, innerScale, rippleScale, rippleOpacity]);

  // Amplitude-responsive halo (grows with voice volume)
  useEffect(() => {
    if (!isRecording) {
      Animated.timing(haloScale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      return;
    }
    // Map amplitude [0..1] → scale [1.0..1.45]
    const target = 1 + Math.min(1, Math.max(0, amplitude)) * 0.45;
    Animated.spring(haloScale, {
      toValue: target,
      friction: 7,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [amplitude, isRecording, haloScale]);

  // --- Tap vs Hold detection ---
  // Hold threshold: if finger stays down > HOLD_MS we treat it as hold-to-record.
  // If released before that, it's a tap → onPress (e.g. navigate to VoiceConversation).
  const HOLD_MS = 200;
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldRef = useRef(false);

  const handlePressIn = useCallback(() => {
    Animated.spring(pressScale, {
      toValue: 0.92,
      friction: 5,
      useNativeDriver: true,
    }).start();
    isHoldRef.current = false;
    holdTimerRef.current = setTimeout(() => {
      isHoldRef.current = true;
      externalPressIn?.();
    }, HOLD_MS);
  }, [externalPressIn, pressScale]);

  const handlePressOut = useCallback(() => {
    Animated.spring(pressScale, {
      toValue: 1,
      friction: 5,
      useNativeDriver: true,
    }).start();
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (isHoldRef.current) {
      // Was a hold → stop recording
      externalPressOut?.();
    }
    // If it was a tap (isHoldRef.current === false), onPress will fire via Pressable
  }, [externalPressOut, pressScale]);

  const handlePress = useCallback(() => {
    // Only fire tap action if it wasn't a hold
    if (!isHoldRef.current) {
      onPress?.();
    }
  }, [onPress]);

  const styles = useMemo(() => createStyles(size), [size]);

  const c = getColors();
  const backgroundColor = isRecording ? '#EF4444' : c.primary;
  const iconName: keyof typeof Feather.glyphMap = 'mic';
  const iconSize = Math.round(size * 0.44);

  return (
    <View style={[styles.container, style]}>
      {/* Ripple wave */}
      {isRecording && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ripple,
            {
              transform: [{ scale: rippleScale }],
              opacity: rippleOpacity,
            },
          ]}
        />
      )}

      {/* Amplitude halo (glow that scales with voice) */}
      {isRecording && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              transform: [{ scale: haloScale }],
            },
          ]}
        />
      )}

      {/* The button itself */}
      <Animated.View
        style={[
          styles.wrapper,
          { transform: [{ scale: Animated.multiply(innerScale, pressScale) }] },
        ]}
      >
        <Pressable
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={isProcessing}
          accessibilityRole="button"
          accessibilityLabel={
            isRecording
              ? 'Остановить запись'
              : isProcessing
              ? 'Обработка'
              : 'Начать голосовую команду'
          }
          accessibilityHint="Начните говорить на русском языке"
          style={[
            styles.button,
            { backgroundColor },
            isProcessing && styles.disabled,
          ]}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Feather name={iconName} size={iconSize} color="#FFFFFF" />
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
});

const createStyles = (size: number) =>
  StyleSheet.create({
    container: {
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ripple: {
      position: 'absolute',
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: '#EF4444',
    },
    halo: {
      position: 'absolute',
      width: size * 1.25,
      height: size * 1.25,
      borderRadius: (size * 1.25) / 2,
      backgroundColor: 'rgba(239, 68, 68, 0.18)',
    },
    wrapper: {
      width: size,
      height: size,
    },
    button: {
      width: size,
      height: size,
      borderRadius: size / 2,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 8,
      elevation: 10,
    },
    disabled: {
      opacity: 0.75,
    },
  });
