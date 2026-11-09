import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { createPushToTalk } from '@/services/push-to-talk';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { storage } from '@/services/storage';
import type { RobotEmotion } from '@/services/robot-emotion';

// Выбор голоса (по полу ассистента) — services/tts-voice.ts, общий с ответами чата.
export { getPreferredVoiceIdentifier } from '@/services/tts-voice';
import { getPreferredVoiceIdentifier } from '@/services/tts-voice';

// ---------------------------------------------------------------
// Lazy-load expo-speech-recognition.
//
// This native module crashes Expo Go on startup (Expo Go doesn't bundle
// custom native modules). We try to require it inside a try/catch so
// the app can still launch in Expo Go — it just falls back to the
// expo-av + Groq Whisper path, which works everywhere.
//
// In a dev-build or production build, the require succeeds and we get
// the full on-device speech recognition feature set.
// ---------------------------------------------------------------
let ExpoSpeechRecognitionModule: any = null;
// Default to a no-op hook so the hooks order stays stable regardless of
// whether the native module is available. React forbids conditional hook
// calls, so we ALWAYS call useSpeechRecognitionEvent — it just does nothing
// in Expo Go.
let useSpeechRecognitionEvent: (event: string, handler: (e: any) => void) => void =
  () => {};

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('expo-speech-recognition');
  if (mod?.ExpoSpeechRecognitionModule) {
    ExpoSpeechRecognitionModule = mod.ExpoSpeechRecognitionModule;
  }
  if (typeof mod?.useSpeechRecognitionEvent === 'function') {
    useSpeechRecognitionEvent = mod.useSpeechRecognitionEvent;
  }
} catch {
  // Not available — e.g. Expo Go. We'll use the expo-av + Groq Whisper fallback.
}

type ExpoSpeechRecognitionOptions = {
  lang?: string;
  interimResults?: boolean;
  continuous?: boolean;
  requiresOnDeviceRecognition?: boolean;
  addsPunctuation?: boolean;
};

/**
 * LifeOS Voice Hook — v2
 *
 * State machine:   idle → recording → processing → speaking → idle
 *                                     ↘ error ↗
 *
 * Primary path (fast): expo-speech-recognition with live partial results.
 *   - No network round-trip for transcription
 *   - Live transcript shown to user
 *   - Uses OS recognizer (Siri on iOS, Google on Android)
 *
 * Fallback path: expo-av record → base64 → /voice/transcribe (Groq Whisper).
 *   - Used if speech recognition permission denied or unavailable.
 *
 * Хук только распознаёт: сказанное (lastResult.transcript) вызывающий шлёт
 * в единый мозг сам (строка ввода → /voice/chat).
 */

export type VoiceState = 'idle' | 'recording' | 'processing' | 'speaking' | 'error';

interface VoiceIntent {
  action: string;
  [key: string]: unknown;
}

interface VoiceResult {
  intent: VoiceIntent;
  response: string;
  transcript: string;
  /** Эмоция робота на этот ход (сервер, по фактам; робот-эпик Часть 2). */
  emotion: RobotEmotion;
  /** «Открой задачи» голосом → ключ панели; экран открывает её (useOpenPanel). */
  openPanel?: string | null;
}

interface TranscribeResponse {
  text: string;
  /** Пусто — почему: тишина или сбой сервиса (сервер говорит честно). */
  message?: string;
  reason?: 'silence' | 'service';
}

export interface UseVoiceReturn {
  state: VoiceState;
  /** True while recording (backward-compat alias for state === 'recording') */
  isRecording: boolean;
  /** True during transcribe/process (backward-compat alias) */
  isProcessing: boolean;
  /** Live transcript updated while user speaks (partial results) */
  liveTranscript: string;
  /** @deprecated Backward-compat alias for liveTranscript */
  transcribedText: string | null;
  /** Final result of the last command */
  lastResult: VoiceResult | null;
  /** Last error message (Russian) if state === 'error' */
  error: string | null;
  /** RMS amplitude 0..1 for waveform visualization while recording */
  amplitude: number;
  /**
   * Start recording. Uses on-device speech recognition if available,
   * falls back to audio recording + remote Whisper otherwise.
   */
  startRecording: () => Promise<void>;
  /** Stop recording and process the result */
  stopRecording: () => Promise<void>;
  /** Cancel recording without processing (like slide-to-cancel in WhatsApp) */
  cancelRecording: () => Promise<void>;
  /** Запись зафиксирована коротким нажатием: идёт сама до «отправить»/«отмена». */
  locked: boolean;
  /** «Отправить» у зафиксированной записи. */
  sendRecording: () => Promise<void>;
  /** Toggle recording on/off */
  toggleRecording: () => Promise<void>;
  /** Speak a message via TTS (Russian) */
  speak: (text: string) => void;
  /** Reset state to idle, clearing any result/error */
  reset: () => void;
}

// -------------------------------------------------------------
// Module-level: detect whether on-device speech recognition is usable
// -------------------------------------------------------------

let speechRecognitionAvailable: boolean | null = null;

/** Короче этого «нажал-отпустил» — короткое нажатие: запись фиксируется (до «отправить»). */
const MIN_HOLD_MS = 350;

async function isSpeechRecognitionAvailable(): Promise<boolean> {
  if (speechRecognitionAvailable !== null) return speechRecognitionAvailable;
  // Module failed to load at import time — we're in Expo Go or similar
  if (!ExpoSpeechRecognitionModule) {
    speechRecognitionAvailable = false;
    return false;
  }
  try {
    const result = await ExpoSpeechRecognitionModule.getStateAsync();
    speechRecognitionAvailable = typeof result === 'string';
  } catch {
    speechRecognitionAvailable = false;
  }
  return speechRecognitionAvailable;
}

// -------------------------------------------------------------
// Fallback: record audio via expo-av and transcribe via Groq
// -------------------------------------------------------------

async function recordAudio(): Promise<{ uri: string | null; cleanup: () => Promise<void> }> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const { recording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY,
    undefined,
    200, // metering interval (ms)
  );

  // Return a handle + cleanup function
  return {
    get uri() {
      return recording.getURI();
    },
    cleanup: async () => {
      try {
        const status = await recording.getStatusAsync();
        if (status.isRecording || status.canRecord) {
          await recording.stopAndUnloadAsync();
        }
      } catch {
        /* ignore */
      }
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      } catch {
        /* ignore */
      }
    },
  } as unknown as { uri: string | null; cleanup: () => Promise<void> };
}

// -------------------------------------------------------------
// Main hook
// -------------------------------------------------------------

export interface UseVoiceOptions {
  /** Исторический флаг: хук и так только распознаёт (текст в мозг шлёт вызывающий). */
  transcribeOnly?: boolean;
}

/** Зафиксированная запись не висит бесконечно: через минуту фраза уходит сама. */
const LOCKED_MAX_MS = 60_000;

export function useVoice(options: UseVoiceOptions = {}): UseVoiceReturn {
  void options;
  const [locked, setLocked] = useState(false);
  const [state, setState] = useState<VoiceState>('idle');
  // Удержание кнопки (push-to-talk): колбэки живут дольше рендера, поэтому
  // правду о состоянии держим в ref-ах, а не в замыкании `state`. Иначе
  // «отпустил» до того, как запись реально началась (разрешения, первый
  // запуск), терялось — запись висла, и микрофон больше не реагировал.
  const stateRef = useRef<VoiceState>('idle');
  const liveTranscriptRef = useRef('');
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const startInnerRef = useRef<() => Promise<void>>(async () => {});
  const cancelRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [lastResult, setLastResult] = useState<VoiceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amplitude, setAmplitude] = useState(0);

  // Refs for state machine internals
  const modeRef = useRef<'speech-recognition' | 'audio-fallback' | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const meteringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalTranscriptRef = useRef('');
  const cancelledRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (meteringIntervalRef.current) {
        clearInterval(meteringIntervalRef.current);
      }
    };
  }, []);

  // ---- Live events from expo-speech-recognition ----

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results?.[0]?.transcript ?? '';
    if (event.isFinal) {
      finalTranscriptRef.current = text;
    }
    liveTranscriptRef.current = text;
    setLiveTranscript(text);
  });

  useSpeechRecognitionEvent('error', (event) => {
    // После нашей отмены iOS шлёт 'aborted' — это не ошибка юзера, и она не
    // должна затирать подсказку «удерживай кнопку». Вне записи — тоже молчим:
    // пустой результат после «стоп» обрабатывает stopRecording.
    if (event.error === 'aborted' || stateRef.current !== 'recording') return;
    // Siri сломалась, пока кнопку держат («Failed to initialize recognizer»,
    // сеть, сбой движка): не падаем в ошибку — молча пересаживаемся на запись
    // звука (Whisper на сервере), и ту же фразу всё равно запишем. Siri на
    // этой сессии больше не трогаем: ломается она стабильно.
    if (modeRef.current === 'speech-recognition' && event.error !== 'no-speech' && event.error !== 'not-allowed') {
      speechRecognitionAvailable = false;
      void switchToAudioFallbackRef.current();
      return;
    }
    if (event.error === 'no-speech') {
      setError('Ничего не услышал. Говорите ближе к микрофону.');
    } else {
      setError('Нет разрешения на распознавание речи. Проверь настройки.');
    }
    // Сессия умерла, пока кнопку держат: не оставляем «вечную запись».
    if (stateRef.current === 'recording' && modeRef.current === 'speech-recognition') {
      modeRef.current = null;
      stateRef.current = 'error';
      setState('error');
    }
  });

  useSpeechRecognitionEvent('end', () => {
    // После нашего stop() обработку ведёт stopRecording. Если распознавание
    // закончилось само, пока кнопку ещё держат (лимит/тишина) — обрабатываем
    // то, что успели услышать, а не висим в «записи».
    if (stateRef.current === 'recording' && modeRef.current === 'speech-recognition') {
      void stopRef.current();
    }
  });

  // ---- Amplitude simulation for waveform when using speech-recognition ----
  // (speech-recognition doesn't expose metering; we pulse synthetically)

  const startSyntheticMeter = useCallback(() => {
    if (meteringIntervalRef.current) clearInterval(meteringIntervalRef.current);
    meteringIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      setAmplitude(0.2 + Math.random() * 0.6);
    }, 120);
  }, []);

  const stopSyntheticMeter = useCallback(() => {
    if (meteringIntervalRef.current) {
      clearInterval(meteringIntervalRef.current);
      meteringIntervalRef.current = null;
    }
    setAmplitude(0);
  }, []);

  // ---- Real metering for expo-av fallback ----

  const startRealMeter = useCallback(() => {
    if (meteringIntervalRef.current) clearInterval(meteringIntervalRef.current);
    meteringIntervalRef.current = setInterval(async () => {
      if (!isMountedRef.current || !recordingRef.current) return;
      try {
        const status = await recordingRef.current.getStatusAsync();
        // metering is in dB, typically -160..0; map to 0..1
        const db = status.metering ?? -160;
        const normalized = Math.max(0, Math.min(1, (db + 60) / 60));
        setAmplitude(normalized);
      } catch {
        /* ignore */
      }
    }, 120);
  }, []);

  // ---- Haptic helpers (never throw) ----

  const hapticLight = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);
  const hapticMedium = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);
  const hapticError = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  }, []);

  // ==========================================================
  // START
  // ==========================================================

  /**
   * Запасной путь: запись звука (expo-av) → /voice/transcribe (Whisper).
   * Зовётся, если Siri недоступна, не стартовала или сломалась в процессе.
   * silent — пересадка посреди нажатия: без повторной вибрации.
   */
  const startAudioFallback = useCallback(async (silent = false) => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setError('Нет доступа к микрофону. Разреши его в Настройках → LifeOS.');
        stateRef.current = 'error';
        setState('error');
        hapticError();
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
          isMeteringEnabled: true,
        } as Audio.RecordingOptions,
      );

      // Пересадка с Siri посреди нажатия, а палец уже отпустили (stopRecording
      // перевёл в 'processing', ни одна ветка не сработала) — запись не оставляем
      // висеть без пальца (аудит 2026-11-09): глушим и просим сказать ещё раз.
      if (silent && stateRef.current !== 'recording') {
        await recording.stopAndUnloadAsync().catch(() => {});
        setError('Не расслышал — нажми и скажи ещё раз.');
        stateRef.current = 'error';
        setState('error');
        return;
      }
      recordingRef.current = recording;
      modeRef.current = 'audio-fallback';
      startRealMeter();
      stateRef.current = 'recording';
      setState('recording');
      if (!silent) hapticMedium();
    } catch {
      setError('Не получилось включить микрофон. Нажми и держи ещё раз.');
      stateRef.current = 'error';
      setState('error');
      hapticError();
    }
  }, [startRealMeter, hapticMedium, hapticError]);

  /** Siri упала посреди записи — тихо переходим на запись звука (та же кнопка, тот же палец). */
  const switchToAudioFallback = useCallback(async () => {
    try {
      ExpoSpeechRecognitionModule?.abort();
    } catch {
      /* ignore */
    }
    stopSyntheticMeter();
    modeRef.current = null;
    if (stateRef.current !== 'recording') return;
    await startAudioFallback(true);
  }, [stopSyntheticMeter, startAudioFallback]);
  const switchToAudioFallbackRef = useRef(switchToAudioFallback);
  useEffect(() => {
    switchToAudioFallbackRef.current = switchToAudioFallback;
  }, [switchToAudioFallback]);

  const startInner = useCallback(async () => {
    setError(null);
    setLastResult(null);
    setLiveTranscript('');
    finalTranscriptRef.current = '';
    liveTranscriptRef.current = '';
    cancelledRef.current = false;

    // Prefer on-device speech recognition
    const canUseSpeech = await isSpeechRecognitionAvailable();

    if (canUseSpeech) {
      try {
        // Первое нажатие: iOS спрашивает разрешения, и палец приходится отпустить,
        // чтобы нажать «Разрешить», — раньше это выглядело как «зависло и не
        // записало». Теперь первое нажатие только спрашивает разрешение.
        const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
        if (!current.granted) {
          const asked = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
          if (asked.granted) {
            setError('Готово! Теперь нажми микрофон и говори.');
            return;
          }
          setError('Нет доступа к микрофону. Разреши его в Настройках → LifeOS.');
          return;
        }

        const options: ExpoSpeechRecognitionOptions = {
          lang: 'ru-RU',
          interimResults: true,
          // Держишь кнопку — слушаем до отпускания, а не до первой паузы.
          continuous: true,
          requiresOnDeviceRecognition: false,
          addsPunctuation: true,
        };

        ExpoSpeechRecognitionModule.start(options);
        modeRef.current = 'speech-recognition';
        startSyntheticMeter();
        stateRef.current = 'recording';
        setState('recording');
        hapticMedium();
        return;
      } catch (err) {
        // Siri не стартовала (нет движка, язык не скачан и т.п.) — запись звука.
        console.warn('Speech recognition failed, falling back to audio recording', err);
        speechRecognitionAvailable = false;
      }
    }

    await startAudioFallback();
  }, [startSyntheticMeter, hapticMedium, startAudioFallback]);

  // ==========================================================
  // CANCEL
  // ==========================================================

  const cancelRecording = useCallback(async () => {
    cancelledRef.current = true;
    stopSyntheticMeter();

    if (modeRef.current === 'speech-recognition') {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        /* ignore */
      }
    } else if (modeRef.current === 'audio-fallback' && recordingRef.current) {
      try {
        const status = await recordingRef.current.getStatusAsync();
        if (status.isRecording || status.canRecord) {
          await recordingRef.current.stopAndUnloadAsync();
        }
      } catch {
        /* ignore */
      }
      recordingRef.current = null;
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      } catch {
        /* ignore */
      }
    }

    modeRef.current = null;
    setLiveTranscript('');
    setLastResult(null);
    stateRef.current = 'idle';
    setState('idle');
    hapticLight();
  }, [stopSyntheticMeter, hapticLight]);

  // ==========================================================
  // STOP + PROCESS
  // ==========================================================

  // Хук только распознаёт речь: фразу дальше шлёт тот, кто его позвал (строка
  // ввода → /voice/chat — один мозг). Ветка «сам отправь в /voice/process и
  // озвучь» была недостижима (все вызовы — transcribeOnly) — убрана 2026-11-09.
  const processCommand = useCallback(async (transcript: string) => {
    if (isMountedRef.current) {
      setLastResult({ intent: { action: 'transcript' }, response: '', transcript, emotion: 'neutral' });
      setState('idle');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (stateRef.current !== 'recording') return;
    stateRef.current = 'processing';
    hapticLight();

    // --- Speech recognition path ---
    if (modeRef.current === 'speech-recognition') {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        /* ignore */
      }
      stopSyntheticMeter();
      setState('processing');

      // Wait briefly for final transcript (event may arrive after stop)
      await new Promise((r) => setTimeout(r, 300));

      const transcript = (finalTranscriptRef.current || liveTranscriptRef.current).trim();
      modeRef.current = null;

      if (cancelledRef.current) {
        setState('idle');
        return;
      }

      if (!transcript) {
        setError('Не расслышал — скажи ещё раз, чуть ближе к микрофону.');
        setState('error');
        hapticError();
        return;
      }

      await processCommand(transcript);
      return;
    }

    // --- Audio recording fallback path ---
    if (modeRef.current === 'audio-fallback' && recordingRef.current) {
      const recording = recordingRef.current;
      stopSyntheticMeter();
      if (meteringIntervalRef.current) {
        clearInterval(meteringIntervalRef.current);
        meteringIntervalRef.current = null;
      }
      setState('processing');

      let uri: string | null = null;
      try {
        const status = await recording.getStatusAsync();
        if (status.isRecording || status.canRecord) {
          await recording.stopAndUnloadAsync();
        }
        uri = recording.getURI();
      } catch (stopErr) {
        console.warn('Recording stop warning:', stopErr);
      }
      recordingRef.current = null;
      modeRef.current = null;

      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      } catch {
        /* ignore */
      }

      if (cancelledRef.current) {
        if (uri) {
          try {
            await FileSystem.deleteAsync(uri);
          } catch {
            /* ignore */
          }
        }
        setState('idle');
        return;
      }

      if (!uri) {
        setError('Не удалось получить запись');
        setState('error');
        hapticError();
        return;
      }

      try {
        const base64Audio = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        if (!base64Audio || base64Audio.length < 200) {
          setError('Запись слишком короткая. Говорите чуть дольше.');
          setState('error');
          hapticError();
          return;
        }

        const token = useAuthStore.getState().token;
        const data = await api.post<TranscribeResponse>(
          '/voice/transcribe',
          { audio: base64Audio, format: Platform.OS === 'ios' ? 'm4a' : 'm4a' },
          token || undefined,
        );

        const transcript = (data.text ?? '').trim();
        setLiveTranscript(transcript);

        if (!transcript) {
          // Сервер различает тишину и свой сбой («сбой на моей стороне, не у
          // тебя») — показываем его слова, а не «говорите громче» на всё.
          setError(data.message || 'Не расслышал — скажи ещё раз, чуть ближе к микрофону.');
          setState('error');
          hapticError();
          return;
        }

        await processCommand(transcript);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка обработки голоса';
        setError(message);
        setState('error');
        hapticError();
      } finally {
        if (uri) {
          try {
            await FileSystem.deleteAsync(uri);
          } catch {
            /* ignore */
          }
        }
      }
    }
  }, [
    processCommand,
    stopSyntheticMeter,
    hapticLight,
    hapticError,
  ]);
  stopRef.current = stopRecording;
  startInnerRef.current = startInner;
  cancelRef.current = cancelRecording;

  // Кнопка как в WhatsApp (services/push-to-talk): короткое нажатие — запись
  // держится сама до «отправить»; удержание — отпустил, отправилось. Гонку
  // «отпустил раньше, чем запись началась» держит там же. Колбэки — через ref.
  const ptt = useMemo(
    () =>
      createPushToTalk({
        start: async () => {
          await startInnerRef.current();
          return stateRef.current === 'recording';
        },
        stop: () => stopRef.current(),
        cancel: () => cancelRef.current(),
        isRecording: () => stateRef.current === 'recording',
        now: () => Date.now(),
        minHoldMs: MIN_HOLD_MS,
        onLockChange: setLocked,
      }),
    [],
  );
  const startRecording = ptt.pressIn;
  const publicStop = ptt.pressOut;
  const sendRecording = ptt.send;
  const cancelViaButton = ptt.cancel;
  const lockedNow = locked && state === 'recording';

  // Запись оборвалась сама (сбой распознавания) — снимаем только фиксацию.
  // Не cancel(): в момент «отправить» он успевал отменить уходящую фразу.
  useEffect(() => {
    if (locked && state !== 'recording') ptt.unlock();
  }, [locked, state, ptt]);

  // Зафиксированная запись — не дольше минуты, потом отправляется сама.
  useEffect(() => {
    if (!lockedNow) return;
    const t = setTimeout(() => void ptt.send(), LOCKED_MAX_MS);
    return () => clearTimeout(t);
  }, [lockedNow, ptt]);

  // ==========================================================
  // TOGGLE
  // ==========================================================

  const toggleRecording = useCallback(async () => {
    if (state === 'recording') {
      await publicStop();
    } else if (state === 'idle' || state === 'error') {
      await startRecording();
    }
  }, [state, startRecording, publicStop]);

  // ==========================================================
  // SPEAK / RESET
  // ==========================================================

  const speak = useCallback(async (text: string) => {
    try {
      const voiceId = await getPreferredVoiceIdentifier();
      Speech.speak(text, { language: 'ru-RU', rate: 1.05, voice: voiceId });
    } catch {
      /* TTS failures are non-critical */
    }
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setLastResult(null);
    setLiveTranscript('');
    setState('idle');
  }, []);

  // Backward-compat derived booleans
  const isRecording = state === 'recording';
  const isProcessing = state === 'processing';

  return useMemo(
    () => ({
      state,
      isRecording,
      isProcessing,
      liveTranscript,
      transcribedText: liveTranscript || null,
      lastResult,
      error,
      amplitude,
      startRecording,
      stopRecording: publicStop,
      cancelRecording: cancelViaButton,
      locked: lockedNow,
      sendRecording,
      toggleRecording,
      speak,
      reset,
    }),
    [
      state,
      isRecording,
      isProcessing,
      liveTranscript,
      lastResult,
      error,
      amplitude,
      startRecording,
      publicStop,
      cancelViaButton,
      lockedNow,
      sendRecording,
      toggleRecording,
      speak,
      reset,
    ],
  );
}
