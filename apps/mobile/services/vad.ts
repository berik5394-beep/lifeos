/**
 * Voice Activity Detection (VAD) — определяет когда пользователь перестал говорить.
 *
 * Работает через анализ уровня громкости (metering) записи expo-av:
 * - Отслеживает dB уровень каждые 100ms
 * - Если тишина (dB ниже порога) держится дольше SILENCE_DURATION → конец речи
 * - Адаптивный порог: автоматически калибруется по фоновому шуму первые 500ms
 *
 * Не требует никаких внешних библиотек — использует встроенный metering из expo-av.
 */

import { Audio } from 'expo-av';

// ─── Configuration ──────────────────────────────────────────────────────────

/** Минимальный уровень dB, ниже которого считается тишиной (-160 = полная тишина) */
const DEFAULT_SILENCE_THRESHOLD_DB = -40;

/** Сколько ms тишины нужно для определения конца речи */
const SILENCE_DURATION_MS = 1500;

/** Интервал опроса уровня громкости */
const METERING_INTERVAL_MS = 100;

/** Сколько ms в начале записи используется для калибровки фонового шума */
const CALIBRATION_DURATION_MS = 500;

/** Минимальная длительность речи перед тем как VAD сработает (чтобы не срабатывал на щелчок кнопки) */
const MIN_SPEECH_DURATION_MS = 800;

/** Смещение выше фонового шума для адаптивного порога */
const ADAPTIVE_OFFSET_DB = 8;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VADCallbacks {
  /** Вызывается при определении конца речи */
  onSpeechEnd: () => void;
  /** Вызывается при изменении состояния (говорит/тишина) */
  onStatusChange?: (isSpeaking: boolean) => void;
  /** Вызывается с текущей нормализованной амплитудой (0-1) для визуализации */
  onAmplitude?: (amplitude: number) => void;
}

export interface VADInstance {
  /** Остановить VAD мониторинг */
  stop: () => void;
  /** Текущее состояние: говорит или нет */
  isSpeaking: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Нормализует dB значение (-160...0) в амплитуду (0...1)
 */
function dbToAmplitude(db: number): number {
  // expo-av metering: -160 = silence, 0 = max
  const clamped = Math.max(-80, Math.min(0, db));
  return (clamped + 80) / 80;
}

// ─── VAD ────────────────────────────────────────────────────────────────────

/**
 * Создаёт VAD инстанс, который мониторит запись и определяет конец речи.
 *
 * @param recording — активная запись expo-av (должна быть создана с isMeteringEnabled: true)
 * @param callbacks — колбэки для событий
 * @returns VADInstance — управление мониторингом
 */
export function createVAD(
  recording: Audio.Recording,
  callbacks: VADCallbacks,
): VADInstance {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let isSpeaking = false;
  let silenceStartTime: number | null = null;
  let speechStartTime: number | null = null;
  let isCalibrating = true;
  let calibrationReadings: number[] = [];
  let silenceThreshold = DEFAULT_SILENCE_THRESHOLD_DB;
  let stopped = false;
  const startTime = Date.now();

  const instance: VADInstance = {
    get isSpeaking() {
      return isSpeaking;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };

  intervalId = setInterval(async () => {
    if (stopped) return;

    try {
      const status = await recording.getStatusAsync();
      if (!status.isRecording) {
        instance.stop();
        return;
      }

      const db = (status as unknown as { metering?: number }).metering ?? -160;
      const amplitude = dbToAmplitude(db);

      // Report amplitude for visualization
      callbacks.onAmplitude?.(amplitude);

      const elapsed = Date.now() - startTime;

      // ── Calibration phase ─────────────────────────────────────────
      if (isCalibrating) {
        calibrationReadings.push(db);
        if (elapsed >= CALIBRATION_DURATION_MS) {
          isCalibrating = false;
          // Set adaptive threshold = avg background noise + offset
          if (calibrationReadings.length > 0) {
            const avgNoise =
              calibrationReadings.reduce((a, b) => a + b, 0) /
              calibrationReadings.length;
            silenceThreshold = Math.min(
              avgNoise + ADAPTIVE_OFFSET_DB,
              DEFAULT_SILENCE_THRESHOLD_DB,
            );
          }
        }
        return;
      }

      // ── Speech detection ──────────────────────────────────────────
      const isCurrentlySpeaking = db > silenceThreshold;

      if (isCurrentlySpeaking) {
        // User is speaking
        silenceStartTime = null;
        if (!isSpeaking) {
          isSpeaking = true;
          speechStartTime = Date.now();
          callbacks.onStatusChange?.(true);
        }
      } else {
        // Silence detected
        if (isSpeaking) {
          // Track when silence started
          if (!silenceStartTime) {
            silenceStartTime = Date.now();
          }

          const silenceDuration = Date.now() - silenceStartTime;
          const speechDuration = speechStartTime
            ? Date.now() - speechStartTime
            : 0;

          if (
            silenceDuration >= SILENCE_DURATION_MS &&
            speechDuration >= MIN_SPEECH_DURATION_MS
          ) {
            // Speech ended!
            isSpeaking = false;
            callbacks.onStatusChange?.(false);
            instance.stop();
            callbacks.onSpeechEnd();
          }
        }
      }
    } catch {
      // Status read failed — recording may have been stopped
      instance.stop();
    }
  }, METERING_INTERVAL_MS);

  return instance;
}
