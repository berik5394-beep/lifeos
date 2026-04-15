import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { storage } from '@/services/storage';

// ==========================================================
// TTS VOICE RESOLUTION (gender-aware)
// ==========================================================
// Picks a russian voice matching the user's assistantGender preference
// stored in MMKV-like storage by onboarding / settings screens.
// Cached per-session; re-resolves when gender changes.
let cachedVoiceId: string | undefined;
let cachedFor: string | undefined;

export async function getPreferredVoiceIdentifier(): Promise<string | undefined> {
  try {
    const gender = (storage.getString('assistantGender') as 'female' | 'male' | undefined) ?? 'female';
    if (cachedFor === gender && cachedVoiceId !== undefined) {
      return cachedVoiceId;
    }
    const voices = await Speech.getAvailableVoicesAsync();
    const russian = voices.filter((v) => v.language?.startsWith('ru'));
    // iOS voices sometimes expose gender via name; Android rarely does.
    // Fall back to name heuristics.
    const byGender = russian.find((v) => {
      const name = (v.name || v.identifier || '').toLowerCase();
      if (gender === 'male') {
        return (
          name.includes('male') ||
          name.includes('мужск') ||
          name.includes('yuri') ||
          name.includes('milena-m')
        );
      }
      return (
        name.includes('female') ||
        name.includes('женск') ||
        name.includes('milena') ||
        name.includes('katya')
      );
    });
    cachedVoiceId = byGender?.identifier ?? russian[0]?.identifier;
    cachedFor = gender;
    return cachedVoiceId;
  } catch {
    return undefined;
  }
}

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
 * Command processing: always goes to /voice/process (parses intent) and
 * optionally /voice/assistant (conversational reply).
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
}

interface TranscribeResponse {
  text: string;
}

interface ProcessResponse {
  intent: VoiceIntent;
  response: string;
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

export function useVoice(): UseVoiceReturn {
  const [state, setState] = useState<VoiceState>('idle');
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
    setLiveTranscript(text);
  });

  useSpeechRecognitionEvent('error', (event) => {
    // code: 'no-speech' | 'audio-capture' | 'not-allowed' | 'network' | ...
    if (event.error === 'no-speech') {
      setError('Ничего не услышал. Говорите ближе к микрофону.');
    } else if (event.error === 'not-allowed') {
      setError('Нет разрешения на распознавание речи. Проверь настройки.');
    } else if (event.error === 'network') {
      setError('Нет интернета — попробуй ещё раз.');
    } else {
      setError('Ошибка распознавания: ' + (event.message || event.error));
    }
  });

  useSpeechRecognitionEvent('end', () => {
    // end fires after stop() — we handle processing in stopRecording()
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
  const hapticSuccess = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);
  const hapticError = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  }, []);

  // ==========================================================
  // START
  // ==========================================================

  const startRecording = useCallback(async () => {
    if (state === 'recording' || state === 'processing') return;

    setError(null);
    setLastResult(null);
    setLiveTranscript('');
    finalTranscriptRef.current = '';
    cancelledRef.current = false;

    // Prefer on-device speech recognition
    const canUseSpeech = await isSpeechRecognitionAvailable();

    if (canUseSpeech) {
      try {
        const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!perm.granted) {
          throw new Error('permission-denied');
        }

        const options: ExpoSpeechRecognitionOptions = {
          lang: 'ru-RU',
          interimResults: true,
          continuous: false,
          requiresOnDeviceRecognition: false,
          addsPunctuation: true,
        };

        ExpoSpeechRecognitionModule.start(options);
        modeRef.current = 'speech-recognition';
        startSyntheticMeter();
        setState('recording');
        hapticMedium();
        return;
      } catch (err) {
        console.warn('Speech recognition failed, falling back to audio recording', err);
        speechRecognitionAvailable = false;
      }
    }

    // Fallback: expo-av recording
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setError('Нет разрешения на запись звука. Проверь настройки.');
        setState('error');
        hapticError();
        Alert.alert('Микрофон', 'Разрешите доступ к микрофону в настройках устройства.');
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

      recordingRef.current = recording;
      modeRef.current = 'audio-fallback';
      startRealMeter();
      setState('recording');
      hapticMedium();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось начать запись';
      setError(message);
      setState('error');
      hapticError();
    }
  }, [state, startRealMeter, startSyntheticMeter, hapticMedium, hapticError]);

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
    setState('idle');
    hapticLight();
  }, [stopSyntheticMeter, hapticLight]);

  // ==========================================================
  // STOP + PROCESS
  // ==========================================================

  const processCommand = useCallback(
    async (transcript: string) => {
      const token = useAuthStore.getState().token;
      try {
        const processData = await api.post<ProcessResponse>(
          '/voice/process',
          { text: transcript },
          token || undefined,
        );

        const result: VoiceResult = {
          intent: processData.intent ?? { action: 'unknown' },
          response:
            processData.response ||
            `Я услышал: «${transcript}». Но не понял команду.`,
          transcript,
        };
        if (isMountedRef.current) {
          setLastResult(result);
          setState('speaking');
          hapticSuccess();
        }
        // Fire-and-forget TTS (gender-aware voice)
        try {
          const voiceId = await getPreferredVoiceIdentifier();
          Speech.speak(result.response, { language: 'ru-RU', rate: 1.05, voice: voiceId });
        } catch {
          /* ignore */
        }
        // Return to idle after a short delay (UI can dismiss state)
        setTimeout(() => {
          if (isMountedRef.current && state !== 'recording') {
            setState((s) => (s === 'speaking' ? 'idle' : s));
          }
        }, 2500);
      } catch (err) {
        console.warn('Voice process failed, showing transcript only', err);
        if (isMountedRef.current) {
          setLastResult({
            intent: { action: 'unknown' },
            response: `Я услышал: «${transcript}». Команда не распознана — попробуй переформулировать.`,
            transcript,
          });
          setState('idle');
          hapticError();
        }
      }
    },
    [state, hapticSuccess, hapticError],
  );

  const stopRecording = useCallback(async () => {
    if (state !== 'recording') return;
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

      const transcript = (finalTranscriptRef.current || liveTranscript).trim();
      modeRef.current = null;

      if (cancelledRef.current) {
        setState('idle');
        return;
      }

      if (!transcript) {
        setError('Не удалось распознать речь. Говорите громче и чётче.');
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
          setError('Не удалось распознать речь. Говорите громче и чётче.');
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
    state,
    liveTranscript,
    processCommand,
    stopSyntheticMeter,
    hapticLight,
    hapticError,
  ]);

  // ==========================================================
  // TOGGLE
  // ==========================================================

  const toggleRecording = useCallback(async () => {
    if (state === 'recording') {
      await stopRecording();
    } else if (state === 'idle' || state === 'error') {
      await startRecording();
    }
  }, [state, startRecording, stopRecording]);

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
      stopRecording,
      cancelRecording,
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
      stopRecording,
      cancelRecording,
      toggleRecording,
      speak,
      reset,
    ],
  );
}
