import React, { useEffect, useRef, useState, useCallback , useMemo} from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { api } from '@/services/api';
import {
  View, Text, StyleSheet, Animated, Easing,
  TouchableOpacity, Dimensions, Alert, Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Accelerometer } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { useAuthStore } from '@/stores/auth-store';

const { width: SCREEN_W } = Dimensions.get('window');
const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

// ===== EXERCISE DETECTION CONFIG =====
// Each exercise has its own accelerometer thresholds
const EXERCISE_CONFIG: Record<string, {
  axis: 'x' | 'y' | 'z';
  downThreshold: number;   // value when going DOWN
  upThreshold: number;     // value when coming back UP
  minInterval: number;     // min ms between reps to avoid double counting
  icon: string;
  instruction: string;
  tipText: string;
  phonePosition: string;
}> = {
  squats: {
    axis: 'y',
    downThreshold: -0.3,   // phone moves down during squat
    upThreshold: 0.2,      // phone comes back up
    minInterval: 800,
    icon: '🦵',
    instruction: 'Держи телефон в руке перед собой',
    tipText: 'Приседай глубоко — телефон отслеживает движение вверх-вниз',
    phonePosition: 'В руке перед грудью',
  },
  pushups: {
    axis: 'z',
    downThreshold: 0.6,    // phone tilts forward when going down
    upThreshold: -0.1,     // phone comes back when pushing up
    minInterval: 1000,
    icon: '💪',
    instruction: 'Положи телефон на пол между руками экраном вверх',
    tipText: 'Телефон на полу — он чувствует каждое отжимание!',
    phonePosition: 'На полу экраном вверх',
  },
  plank: {
    axis: 'z',
    downThreshold: 0.8,    // detect when body shakes/drops
    upThreshold: 0.3,
    minInterval: 30000,    // plank counts in seconds, not reps
    icon: '🧘',
    instruction: 'Положи телефон на спину в планке',
    tipText: 'Держи тело ровно — телефон следит за стабильностью!',
    phonePosition: 'На спине в планке',
  },
  burpees: {
    axis: 'y',
    downThreshold: -0.5,
    upThreshold: 0.5,
    minInterval: 1500,
    icon: '🔥',
    instruction: 'Держи телефон в руке',
    tipText: 'Полный бёрпи = присед + отжимание + прыжок',
    phonePosition: 'В руке',
  },
  jumps: {
    axis: 'y',
    downThreshold: -0.4,
    upThreshold: 0.6,
    minInterval: 600,
    icon: '🦘',
    instruction: 'Держи телефон в руке или кармане',
    tipText: 'Прыгай выше — телефон считает каждый прыжок!',
    phonePosition: 'В руке или кармане',
  },
  lunges: {
    axis: 'y',
    downThreshold: -0.25,
    upThreshold: 0.15,
    minInterval: 1200,
    icon: '🏃',
    instruction: 'Держи телефон в руке перед собой',
    tipText: 'Выпад вперёд — колено до пола!',
    phonePosition: 'В руке перед грудью',
  },
  situps: {
    axis: 'z',
    downThreshold: 0.5,
    upThreshold: -0.2,
    minInterval: 900,
    icon: '🤸',
    instruction: 'Держи телефон на груди',
    tipText: 'Поднимайся полностью — телефон считает!',
    phonePosition: 'На груди, прижми руками',
  },
  highknees: {
    axis: 'y',
    downThreshold: -0.3,
    upThreshold: 0.4,
    minInterval: 400,
    icon: '🏃‍♂️',
    instruction: 'Держи телефон в руке',
    tipText: 'Колени выше пояса!',
    phonePosition: 'В руке',
  },
};

// Default fallback
const DEFAULT_CONFIG = EXERCISE_CONFIG.squats;

interface RouteParams {
  challengeId: string;
  exercise: string;
  exerciseName: string;
  targetReps: number;
  unit: string;
  opponentName: string;
  opponentTarget: number;
}

type TrackerPhase = 'setup' | 'countdown' | 'active' | 'done';

export default function ExerciseTracker() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
  const route = useRoute();
  const params = route.params as RouteParams;
  const { token } = useAuthStore();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const config = EXERCISE_CONFIG[params.exercise] || DEFAULT_CONFIG;
  const isPlank = params.exercise === 'plank';

  // State
  const [phase, setPhase] = useState<TrackerPhase>('setup');
  const [countdown, setCountdown] = useState(3);
  const [reps, setReps] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [isDown, setIsDown] = useState(false);
  const [sensorData, setSensorData] = useState({ x: 0, y: 0, z: 0 });
  const [completed, setCompleted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Camera verification state
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifyReason, setVerifyReason] = useState<string>('');
  const [serverStartTime, setServerStartTime] = useState<string | null>(null);

  // Animations
  const repScale = useRef(new Animated.Value(1)).current;
  const repGlow = useRef(new Animated.Value(0)).current;
  const progressWidth = useRef(new Animated.Value(0)).current;
  const pulseRing = useRef(new Animated.Value(0)).current;
  const shakeX = useRef(new Animated.Value(0)).current;
  const countdownScale = useRef(new Animated.Value(1)).current;
  const sensorBarHeight = useRef(new Animated.Value(0.5)).current;
  const completedScale = useRef(new Animated.Value(0)).current;

  // Refs for sensor callback
  const repsRef = useRef(0);
  const isDownRef = useRef(false);
  const lastRepTime = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sensorSubRef = useRef<any>(null);

  // === REP DETECTED ANIMATION ===
  const onRepDetected = useCallback(() => {
    const now = Date.now();
    if (now - lastRepTime.current < config.minInterval) return;
    lastRepTime.current = now;

    repsRef.current += 1;
    setReps(repsRef.current);

    // Haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    // Visual feedback — pulse the counter
    Animated.sequence([
      Animated.timing(repScale, { toValue: 1.3, duration: 100, useNativeDriver: true }),
      Animated.timing(repScale, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    // Glow ring
    Animated.sequence([
      Animated.timing(repGlow, { toValue: 1, duration: 100, useNativeDriver: true }),
      Animated.timing(repGlow, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();

    // Pulse ring outward
    pulseRing.setValue(0);
    Animated.timing(pulseRing, { toValue: 1, duration: 500, useNativeDriver: true }).start();

    // Update progress bar
    const progress = Math.min(1, repsRef.current / params.targetReps);
    Animated.timing(progressWidth, { toValue: progress, duration: 200, useNativeDriver: false }).start();

    // Check if target reached
    if (repsRef.current >= params.targetReps) {
      finishExercise();
    }
  }, [params.targetReps]);

  // === ACCELEROMETER LISTENER ===
  const startSensor = useCallback(() => {
    Accelerometer.setUpdateInterval(50); // 20 Hz for smooth detection

    sensorSubRef.current = Accelerometer.addListener(({ x, y, z }) => {
      setSensorData({ x, y, z });

      // Animate the sensor visualization bar
      const axisValue = config.axis === 'x' ? x : config.axis === 'y' ? y : z;
      const normalized = (axisValue + 1.5) / 3; // normalize to 0-1 range
      sensorBarHeight.setValue(Math.max(0, Math.min(1, normalized)));

      // Skip plank — it uses time, not reps
      if (isPlank) return;

      // Detection: two-phase (down then up = 1 rep)
      if (!isDownRef.current) {
        // Waiting for DOWN movement
        if (axisValue < config.downThreshold) {
          isDownRef.current = true;
          setIsDown(true);
        }
      } else {
        // Waiting for UP movement (return to standing)
        if (axisValue > config.upThreshold) {
          isDownRef.current = false;
          setIsDown(false);
          onRepDetected();
        }
      }
    });
  }, [config, onRepDetected]);

  const stopSensor = useCallback(() => {
    if (sensorSubRef.current) {
      sensorSubRef.current.remove();
      sensorSubRef.current = null;
    }
  }, []);

  // === TIMER (runs during active phase) ===
  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      setSeconds(prev => {
        const next = prev + 1;
        // For plank: each second is a "rep"
        if (isPlank) {
          repsRef.current = next;
          setReps(next);
          const progress = Math.min(1, next / params.targetReps);
          Animated.timing(progressWidth, { toValue: progress, duration: 900, useNativeDriver: false }).start();
          if (next >= params.targetReps) {
            finishExercise();
          }
        }
        return next;
      });
    }, 1000);
  }, [isPlank, params.targetReps]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // === FINISH ===
  const finishExercise = useCallback(() => {
    setPhase('done');
    setCompleted(true);
    stopSensor();
    stopTimer();

    // Celebration animation
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Vibration.vibrate([0, 100, 50, 100]);

    Animated.spring(completedScale, {
      toValue: 1,
      friction: 4,
      tension: 60,
      useNativeDriver: true,
    }).start();
  }, []);

  // === COUNTDOWN & START ===
  const beginCountdown = useCallback(() => {
    setPhase('countdown');
    setCountdown(3);

    let count = 3;
    const interval = setInterval(() => {
      count--;
      setCountdown(count);

      // Countdown pulse
      Animated.sequence([
        Animated.timing(countdownScale, { toValue: 1.5, duration: 150, useNativeDriver: true }),
        Animated.timing(countdownScale, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      if (count <= 0) {
        clearInterval(interval);
        setPhase('active');
        startSensor();
        startTimer();

        // SECURITY: record server-side start time so /challenge/complete
        // computes elapsed honestly (prevents client "time=0" exploits)
        api
          .post<{ startedAt: string }>(
            '/challenge/start',
            { challengeId: params.challengeId },
            token || undefined,
          )
          .then((res) => {
            setServerStartTime(res.startedAt);
          })
          .catch((err) => {
            console.warn('[exercise-tracker] /challenge/start failed', err);
          });
      }
    }, 1000);
  }, [startSensor, startTimer, params.challengeId, token]);

  // === CAMERA VERIFICATION ===
  // Optional. User takes a photo mid/after exercise, Claude Vision confirms
  // they were actually doing the exercise. On success sets `verified=true`
  // which is passed to /challenge/complete.
  const verifyWithCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Нет доступа', 'Разреши доступ к камере в настройках.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.3,
      base64: false,
      allowsEditing: false,
      exif: false,
      cameraType: ImagePicker.CameraType.front,
    });

    if (result.canceled || !result.assets[0]) return;

    setVerifying(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(result.assets[0].uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      type VerifyResponse = {
        verified: boolean;
        confidence: 'high' | 'medium' | 'low';
        detectedActivity: string;
        reason: string;
        formFeedback?: string;
      };

      const data = await api.post<VerifyResponse>(
        '/vision/verify-exercise',
        {
          image: base64,
          mediaType: 'image/jpeg',
          exercise: params.exercise,
          challengeId: params.challengeId,
        },
        token || undefined,
      );

      setVerified(data.verified);
      setVerifyReason(data.reason || data.detectedActivity);

      if (data.verified) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert('✅ Подтверждено', data.reason);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        Alert.alert(
          '🤔 Не могу подтвердить',
          `${data.reason}\n\nТы всё равно можешь отправить результат без верификации.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка проверки';
      Alert.alert('Ошибка', msg);
    } finally {
      setVerifying(false);
    }
  }, [params.exercise, params.challengeId, token]);

  // === SUBMIT RESULT ===
  // Server computes `timeSeconds` from its own start timestamp (see
  // /challenge/start). We only pass the optional `verified` flag.
  const submitResult = useCallback(async () => {
    setSubmitting(true);
    try {
      type CompleteResponse = {
        waitingForOpponent: boolean;
        winnerId?: string;
        attackerTime?: number;
        defenderTime?: number;
        trophyReward?: number;
        xpReward?: number;
        isDraw?: boolean;
      };
      const data = await api.post<CompleteResponse>(
        '/challenge/complete',
        {
          challengeId: params.challengeId,
          verified: verified || undefined,
        },
        token || undefined,
      );

      if (data.waitingForOpponent) {
        Alert.alert(
          '✅ Отлично!',
          `${params.exerciseName}: ${reps} ${params.unit}\n\nЖдём противника...`,
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
      } else if (data.winnerId) {
        const won = data.winnerId !== params.opponentName;
        Alert.alert(
          won ? '🎉 ПОБЕДА!' : '😤 Поражение',
          `Ты: ${data.attackerTime}с\nПротивник: ${data.defenderTime}с\n\n${
            won ? `+${data.trophyReward} 🏆 +${data.xpReward} XP` : 'В следующий раз!'
          }`,
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
      } else {
        Alert.alert('🤝 Ничья!', 'Одинаковое время!', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Не удалось отправить результат';
      Alert.alert('Ошибка', rawMsg);
    } finally {
      setSubmitting(false);
    }
  }, [params, reps, token, verified, navigation]);

  // Manual rep add (tap to add)
  const manualRep = useCallback(() => {
    if (phase !== 'active' || isPlank) return;
    onRepDetected();
  }, [phase, isPlank, onRepDetected]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSensor();
      stopTimer();
    };
  }, []);

  const progress = Math.min(1, reps / params.targetReps);
  const progressPercent = Math.round(progress * 100);

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>

        {/* === SETUP PHASE === */}
        {phase === 'setup' && (
          <View style={styles.setupContainer}>
            <Text style={styles.exerciseIcon}>{config.icon}</Text>
            <Text style={styles.exerciseTitle}>{params.exerciseName}</Text>
            <Text style={styles.targetText}>
              Цель: {params.targetReps} {params.unit}
            </Text>
            <Text style={styles.vsOpponent}>
              VS {params.opponentName}: {params.opponentTarget} {params.unit}
            </Text>

            <View style={styles.instructionCard}>
              <Text style={styles.instructionTitle}>📱 Куда положить телефон:</Text>
              <Text style={styles.instructionText}>{config.phonePosition}</Text>
              <View style={styles.divider} />
              <Text style={styles.tipTitle}>💡 Совет:</Text>
              <Text style={styles.tipText}>{config.tipText}</Text>
            </View>

            <TouchableOpacity style={styles.startButton} onPress={beginCountdown} activeOpacity={0.8}>
              <Text style={styles.startButtonText}>🚀 НАЧАТЬ</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelLink} onPress={() => navigation.goBack()}>
              <Text style={styles.cancelLinkText}>Отмена</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* === COUNTDOWN === */}
        {phase === 'countdown' && (
          <View style={styles.countdownContainer}>
            <Text style={styles.getReadyText}>Приготовься!</Text>
            <Animated.Text style={[styles.countdownNumber, {
              transform: [{ scale: countdownScale }],
            }]}>
              {countdown}
            </Animated.Text>
            <Text style={styles.countdownHint}>{config.instruction}</Text>
          </View>
        )}

        {/* === ACTIVE TRACKING === */}
        {phase === 'active' && (
          <TouchableOpacity
            style={styles.activeContainer}
            onPress={manualRep}
            activeOpacity={0.9}
          >
            {/* Timer top bar */}
            <View style={styles.timerBar}>
              <Text style={styles.timerIcon}>⏱️</Text>
              <Text style={styles.timerValue}>{seconds}с</Text>
            </View>

            {/* Main rep counter — big circle */}
            <View style={styles.repCircleOuter}>
              {/* Pulse ring on rep */}
              <Animated.View style={[styles.pulseRingOuter, {
                opacity: pulseRing.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
                transform: [{
                  scale: pulseRing.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }),
                }],
              }]} />

              {/* Glow ring */}
              <Animated.View style={[styles.glowRing, {
                opacity: repGlow,
                transform: [{ scale: repGlow.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.1] }) }],
              }]} />

              {/* Counter */}
              <Animated.View style={[styles.repCircleInner, {
                transform: [{ scale: repScale }],
              }]}>
                <Text style={styles.repCount}>{reps}</Text>
                <Text style={styles.repTarget}>/ {params.targetReps}</Text>
              </Animated.View>
            </View>

            {/* Progress bar */}
            <View style={styles.progressBarContainer}>
              <Animated.View style={[styles.progressBarFill, {
                width: progressWidth.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
                backgroundColor: progress < 0.5 ? c.warning : progress < 0.9 ? c.accent : c.success,
              }]} />
              <Text style={styles.progressText}>{progressPercent}%</Text>
            </View>

            {/* Sensor visualization */}
            <View style={styles.sensorViz}>
              <Text style={styles.sensorLabel}>
                {isDown ? '⬇️ Вниз' : '⬆️ Вверх'}
              </Text>
              <View style={styles.sensorBarBg}>
                <Animated.View style={[styles.sensorBarFill, {
                  height: sensorBarHeight.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                  backgroundColor: isDown ? c.danger : c.success,
                }]} />
              </View>
              <Text style={styles.sensorAxisValue}>
                {config.axis.toUpperCase()}: {sensorData[config.axis].toFixed(2)}
              </Text>
            </View>

            {/* Manual tap hint */}
            <Text style={styles.tapHint}>
              {isPlank ? 'Держи планку!' : 'Нажми на экран если датчик пропустил'}
            </Text>

            {/* Finish early button */}
            <TouchableOpacity style={styles.finishEarlyBtn} onPress={finishExercise}>
              <Text style={styles.finishEarlyText}>Завершить досрочно</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        {/* === DONE === */}
        {phase === 'done' && (
          <View style={styles.doneContainer}>
            <Animated.View style={[styles.doneCard, {
              transform: [{ scale: completedScale }],
            }]}>
              <Text style={styles.doneEmoji}>🎉</Text>
              <Text style={styles.doneTitle}>ВЫПОЛНЕНО!</Text>
              <Text style={styles.doneExercise}>
                {config.icon} {params.exerciseName}
              </Text>
              <View style={styles.doneStats}>
                <View style={styles.doneStat}>
                  <Text style={styles.doneStatValue}>{reps}</Text>
                  <Text style={styles.doneStatLabel}>{params.unit}</Text>
                </View>
                <View style={styles.doneStatDivider} />
                <View style={styles.doneStat}>
                  <Text style={styles.doneStatValue}>{seconds}с</Text>
                  <Text style={styles.doneStatLabel}>время</Text>
                </View>
              </View>

              {/* Camera verification (optional) */}
              <TouchableOpacity
                style={[
                  styles.verifyBtn,
                  verified && styles.verifyBtnOn,
                  verifying && styles.submitBtnDisabled,
                ]}
                onPress={verifyWithCamera}
                disabled={verifying || submitting}
                activeOpacity={0.8}
              >
                <Text style={styles.verifyBtnText}>
                  {verifying
                    ? 'Проверяю камерой...'
                    : verified
                    ? '✅ Подтверждено камерой'
                    : '📸 Проверить камерой (бонус)'}
                </Text>
              </TouchableOpacity>
              {!!verifyReason && !verified && (
                <Text style={styles.verifyReason}>{verifyReason}</Text>
              )}

              <TouchableOpacity
                style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
                onPress={submitResult}
                disabled={submitting}
                activeOpacity={0.8}
              >
                <Text style={styles.submitBtnText}>
                  {submitting ? 'Отправка...' : '📤 Отправить результат'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelLink} onPress={() => navigation.goBack()}>
                <Text style={styles.cancelLinkText}>Не отправлять</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}

      </SafeAreaView>
    </View>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  safeArea: { flex: 1 },

  // Setup
  setupContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  exerciseIcon: { fontSize: 80, marginBottom: 8 },
  exerciseTitle: { color: c.text, fontSize: 28, fontWeight: '900', marginBottom: 8 },
  targetText: { color: c.success, fontSize: fontSize.lg, fontWeight: '700', marginBottom: 4 },
  vsOpponent: { color: c.warning, fontSize: fontSize.md, fontWeight: '600', marginBottom: 20 },
  instructionCard: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: borderRadius.xl,
    padding: spacing.lg, width: '100%', marginBottom: 24,
  },
  instructionTitle: { color: c.text, fontSize: fontSize.md, fontWeight: '700', marginBottom: 6 },
  instructionText: { color: c.textSecondary, fontSize: fontSize.md, fontWeight: '600', marginBottom: 12 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 12 },
  tipTitle: { color: c.text, fontSize: fontSize.sm, fontWeight: '700', marginBottom: 4 },
  tipText: { color: c.textSecondary, fontSize: fontSize.sm, lineHeight: 20 },
  startButton: {
    backgroundColor: c.success, paddingHorizontal: 60, paddingVertical: 18,
    borderRadius: borderRadius.xl, shadowColor: c.success, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  startButtonText: { color: c.text, fontSize: fontSize.lg, fontWeight: '900' },
  cancelLink: { marginTop: 16, paddingVertical: 8 },
  cancelLinkText: { color: c.textSecondary, fontSize: fontSize.sm },

  // Countdown
  countdownContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  getReadyText: { color: c.warning, fontSize: fontSize.lg, fontWeight: '700', marginBottom: 20 },
  countdownNumber: { color: c.text, fontSize: 120, fontWeight: '900' },
  countdownHint: { color: c.textSecondary, fontSize: fontSize.md, marginTop: 20, textAlign: 'center', paddingHorizontal: 40 },

  // Active tracking
  activeContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  timerBar: {
    position: 'absolute', top: 10, right: 20,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20,
  },
  timerIcon: { fontSize: 16 },
  timerValue: { color: c.text, fontSize: fontSize.md, fontWeight: '700' },

  // Rep circle
  repCircleOuter: { alignItems: 'center', justifyContent: 'center', width: 200, height: 200, marginBottom: 24 },
  pulseRingOuter: {
    position: 'absolute', width: 220, height: 220, borderRadius: 110,
    borderWidth: 3, borderColor: c.success,
  },
  glowRing: {
    position: 'absolute', width: 210, height: 210, borderRadius: 105,
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  repCircleInner: {
    width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 3, borderColor: c.success,
    alignItems: 'center', justifyContent: 'center',
  },
  repCount: { color: c.text, fontSize: 64, fontWeight: '900', lineHeight: 72 },
  repTarget: { color: c.textSecondary, fontSize: fontSize.lg, fontWeight: '600' },

  // Progress bar
  progressBarContainer: {
    width: '90%', height: 12, backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 6, marginBottom: 16, overflow: 'hidden', position: 'relative',
  },
  progressBarFill: { height: '100%', borderRadius: 6 },
  progressText: {
    position: 'absolute', right: 8, top: -1, color: c.text,
    fontSize: 9, fontWeight: '800',
  },

  // Sensor visualization
  sensorViz: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  sensorLabel: { color: c.text, fontSize: fontSize.sm, fontWeight: '700', width: 70 },
  sensorBarBg: {
    width: 20, height: 80, backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10, overflow: 'hidden', justifyContent: 'flex-end',
  },
  sensorBarFill: { width: '100%', borderRadius: 10 },
  sensorAxisValue: { color: c.textSecondary, fontSize: fontSize.xs, fontFamily: 'monospace' },

  // Hints
  tapHint: { color: 'rgba(255,255,255,0.4)', fontSize: fontSize.xs, marginBottom: 12, textAlign: 'center' },
  finishEarlyBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: borderRadius.md,
  },
  finishEarlyText: { color: c.textSecondary, fontSize: fontSize.sm },

  // Done screen
  doneContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  doneCard: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: borderRadius.xl,
    padding: spacing.xl, alignItems: 'center', width: '100%',
    borderWidth: 2, borderColor: c.success,
  },
  doneEmoji: { fontSize: 60, marginBottom: 8 },
  doneTitle: { color: c.success, fontSize: 28, fontWeight: '900', marginBottom: 4 },
  doneExercise: { color: c.text, fontSize: fontSize.lg, fontWeight: '700', marginBottom: 20 },
  doneStats: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  doneStat: { alignItems: 'center', paddingHorizontal: 24 },
  doneStatValue: { color: c.text, fontSize: 36, fontWeight: '900' },
  doneStatLabel: { color: c.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  doneStatDivider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.2)' },
  submitBtn: {
    backgroundColor: c.success, paddingHorizontal: 40, paddingVertical: 14,
    borderRadius: borderRadius.lg, marginBottom: 8,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: c.text, fontSize: fontSize.md, fontWeight: '800' },
  verifyBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.4)',
    alignItems: 'center',
  },
  verifyBtnOn: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
    borderColor: 'rgba(34, 197, 94, 0.7)',
  },
  verifyBtnText: {
    color: c.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  verifyReason: {
    color: c.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 6,
    textAlign: 'center',
  },
  });
}
