import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';

export interface VoiceOverlayProps {
  /** Show overlay when true */
  visible: boolean;
  /** Current state from useVoice */
  state: 'idle' | 'recording' | 'processing' | 'speaking' | 'error';
  /** Live partial transcript from useVoice */
  liveTranscript: string;
  /** Final result (intent + response) if available */
  response?: string | null;
  /** Error message if state === 'error' */
  error?: string | null;
  /** Amplitude 0..1 for waveform bars */
  amplitude?: number;
  /** Cancel button — called when user taps backdrop or X */
  onCancel: () => void;
  /** Stop button — called when user taps the stop/send action */
  onStop: () => void;
}

const BARS = 20;
const BAR_WIDTH = 4;
const BAR_GAP = 4;
const BAR_MAX = 60;
const BAR_MIN = 6;

/**
 * Live voice overlay: large transparent modal that shows what the user is
 * currently saying (live transcript + waveform) and the AI response when it
 * finishes processing.
 *
 * Design notes:
 *   - Backdrop tap cancels silently (no submission)
 *   - Waveform bars use amplitude-driven random height with a damped spring
 *     so they feel organic without needing real FFT data
 *   - Single visible state at a time based on `state`
 */
export function VoiceOverlay({
  visible,
  state,
  liveTranscript,
  response,
  error,
  amplitude = 0,
  onCancel,
  onStop,
}: VoiceOverlayProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  // Bar heights — array of Animated.Values
  const barHeights = useRef<Animated.Value[]>(
    Array.from({ length: BARS }, () => new Animated.Value(BAR_MIN)),
  ).current;

  // Animate bars on amplitude change
  useEffect(() => {
    if (state !== 'recording') {
      barHeights.forEach((b) => {
        Animated.timing(b, {
          toValue: BAR_MIN,
          duration: 150,
          useNativeDriver: false,
        }).start();
      });
      return;
    }
    const range = BAR_MAX - BAR_MIN;
    const base = BAR_MIN + amplitude * range * 0.4;
    const peakJitter = amplitude * range * 0.6;
    barHeights.forEach((b, i) => {
      // Create a wave-like pattern: center bars are taller
      const center = BARS / 2;
      const distFromCenter = Math.abs(i - center) / center;
      const randomness = 0.5 + Math.random() * 0.8;
      const h = base + peakJitter * (1 - distFromCenter * 0.4) * randomness;
      Animated.timing(b, {
        toValue: Math.max(BAR_MIN, Math.min(BAR_MAX, h)),
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    });
  }, [amplitude, state, barHeights]);

  const title = useMemo(() => {
    switch (state) {
      case 'recording':
        return 'Слушаю…';
      case 'processing':
        return 'Обрабатываю…';
      case 'speaking':
        return 'Готово';
      case 'error':
        return 'Ошибка';
      default:
        return '';
    }
  }, [state]);

  const showWaveform = state === 'recording' || state === 'processing';
  const showResponse = state === 'speaking' && !!response;
  const showError = state === 'error' && !!error;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={styles.card}
          // Prevent backdrop tap from propagating
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable
              onPress={onCancel}
              hitSlop={10}
              accessibilityLabel="Закрыть"
              accessibilityRole="button"
            >
              <Feather name="x" size={22} color={c.textSecondary} />
            </Pressable>
          </View>

          {showWaveform && (
            <View style={styles.waveform}>
              {barHeights.map((h, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.bar,
                    {
                      height: h,
                      backgroundColor: state === 'recording' ? c.danger : c.primary,
                    },
                  ]}
                />
              ))}
            </View>
          )}

          {!!liveTranscript && (
            <View style={styles.transcriptBox}>
              <Text style={styles.transcriptLabel}>Вы говорите:</Text>
              <Text style={styles.transcriptText}>{liveTranscript}</Text>
            </View>
          )}

          {showResponse && (
            <View style={styles.responseBox}>
              <Text style={styles.responseLabel}>Ответ:</Text>
              <Text style={styles.responseText}>{response}</Text>
            </View>
          )}

          {showError && (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={18} color={c.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {state === 'recording' && (
            <Pressable
              onPress={onStop}
              style={styles.stopButton}
              accessibilityLabel="Остановить запись"
              accessibilityRole="button"
            >
              <Feather name="square" size={18} color="#FFFFFF" />
              <Text style={styles.stopButtonText}>Готово</Text>
            </Pressable>
          )}

          {state === 'idle' && (
            <Text style={styles.hint}>Нажмите «Готово» или ещё раз на кнопку микрофона</Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 140,
    paddingHorizontal: 16,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: c.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    color: c.text,
    fontSize: 18,
    fontWeight: '700',
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: BAR_MAX,
    gap: BAR_GAP,
    marginVertical: 12,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
  },
  transcriptBox: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  transcriptLabel: {
    color: c.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  transcriptText: {
    color: c.text,
    fontSize: 16,
    lineHeight: 22,
  },
  responseBox: {
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  responseLabel: {
    color: c.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  responseText: {
    color: c.text,
    fontSize: 16,
    lineHeight: 22,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  errorText: {
    color: c.danger,
    fontSize: 14,
    flex: 1,
  },
  stopButton: {
    marginTop: 16,
    backgroundColor: c.danger,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  stopButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  hint: {
    color: c.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
  });
}
