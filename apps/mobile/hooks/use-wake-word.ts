import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

// Lazy-load expo-speech-recognition. It's a native module and crashes
// Expo Go at import time. In Expo Go, wake-word becomes a no-op — the
// hook still exists so consumer components don't break, but it never
// activates. Users need a dev build to use this feature.
let ExpoSpeechRecognitionModule: any = null;
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
  // Not available — e.g. Expo Go. Wake word disabled.
}

/**
 * LifeOS — Wake Word Hook
 *
 * Continuous background listening for a wake phrase ("Привет ЛайфОС",
 * "Эй ЛайфОС", "Слушай ЛайфОС"). When detected, fires onWakeWord() which
 * typically triggers the main voice flow in useVoice().
 *
 * How it works:
 *   1. Starts expo-speech-recognition in continuous mode with interim results
 *   2. On every partial transcript, checks for any of WAKE_PHRASES
 *   3. If matched, pauses listening, calls onWakeWord(), then resumes after
 *      a short cooldown (1.5 s) to avoid immediate re-triggering
 *   4. Auto-restarts on error (network blips, timeouts) with backoff
 *   5. Stops cleanly when the component unmounts or app goes to background
 *
 * Caveats:
 *   - iOS SFSpeechRecognizer has a ~1-minute per-session cap. We auto-restart.
 *   - Drain: this keeps the mic hot; mount it selectively (e.g. on dashboard
 *     only) and let the user toggle it in settings.
 *   - Not truly "wake word detection" — it's continuous transcription with
 *     phrase matching. Good enough for Russian and cheap to run.
 */

const WAKE_PHRASES = [
  'привет лайфос',
  'привет лайф ос',
  'привет лайв ос',
  'эй лайфос',
  'слушай лайфос',
  'лайфос слушай',
  'окей лайфос',
];

const RESTART_DELAY_MS = 800;
const COOLDOWN_AFTER_WAKE_MS = 1500;
const IOS_SESSION_REFRESH_MS = 50_000; // iOS cap is ~60s — refresh before that

export interface UseWakeWordOptions {
  enabled: boolean;
  onWakeWord: (matchedPhrase: string, transcript: string) => void;
  /** Called when enable/disable succeeds or fails */
  onStatusChange?: (status: 'active' | 'paused' | 'error') => void;
}

export interface UseWakeWordReturn {
  isActive: boolean;
  lastHeard: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function findWakePhrase(transcript: string): string | null {
  const n = normalize(transcript);
  for (const phrase of WAKE_PHRASES) {
    if (n.includes(phrase)) return phrase;
  }
  return null;
}

export function useWakeWord({
  enabled,
  onWakeWord,
  onStatusChange,
}: UseWakeWordOptions): UseWakeWordReturn {
  const [isActive, setIsActive] = useState(false);
  const [lastHeard, setLastHeard] = useState('');

  const cooldownRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isMountedRef = useRef(true);
  const onWakeWordRef = useRef(onWakeWord);
  const onStatusRef = useRef(onStatusChange);

  // Keep latest callbacks without retriggering effects
  useEffect(() => {
    onWakeWordRef.current = onWakeWord;
    onStatusRef.current = onStatusChange;
  }, [onWakeWord, onStatusChange]);

  const clearTimers = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (sessionRefreshRef.current) {
      clearTimeout(sessionRefreshRef.current);
      sessionRefreshRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    clearTimers();
    if (ExpoSpeechRecognitionModule) {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        /* ignore */
      }
    }
    if (isMountedRef.current) {
      setIsActive(false);
      onStatusRef.current?.('paused');
    }
  }, [clearTimers]);

  const startListening = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (appStateRef.current !== 'active') return;

    // Native module not available (Expo Go) — wake word feature is disabled.
    if (!ExpoSpeechRecognitionModule) {
      onStatusRef.current?.('error');
      return;
    }

    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        onStatusRef.current?.('error');
        return;
      }

      ExpoSpeechRecognitionModule.start({
        lang: 'ru-RU',
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: false,
        addsPunctuation: false,
      });

      if (isMountedRef.current) {
        setIsActive(true);
        onStatusRef.current?.('active');
      }

      // iOS sessions are capped — schedule a refresh before the cap hits
      if (sessionRefreshRef.current) clearTimeout(sessionRefreshRef.current);
      sessionRefreshRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch {
          /* ignore */
        }
        // onend handler below will restart
      }, IOS_SESSION_REFRESH_MS);
    } catch (err) {
      console.warn('Wake word: start failed', err);
      onStatusRef.current?.('error');
      // Retry after backoff
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (isMountedRef.current && enabled) startListening();
      }, 3000);
    }
  }, [enabled]);

  const restartListening = useCallback(() => {
    if (!isMountedRef.current || !enabled) return;
    clearTimers();
    restartTimerRef.current = setTimeout(() => {
      if (isMountedRef.current && enabled) startListening();
    }, RESTART_DELAY_MS);
  }, [clearTimers, enabled, startListening]);

  // Speech recognition events
  useSpeechRecognitionEvent('result', (event) => {
    if (!enabled || cooldownRef.current) return;
    const transcript = event.results?.[0]?.transcript ?? '';
    if (!transcript) return;
    setLastHeard(transcript);

    const matched = findWakePhrase(transcript);
    if (matched) {
      // Wake word detected — cool down to prevent repeat triggering
      cooldownRef.current = true;
      setTimeout(() => {
        cooldownRef.current = false;
      }, COOLDOWN_AFTER_WAKE_MS);

      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        /* ignore */
      }
      try {
        onWakeWordRef.current(matched, transcript);
      } catch (err) {
        console.warn('Wake word callback threw', err);
      }
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!enabled) return;
    // Permissions problems are terminal
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      onStatusRef.current?.('error');
      return;
    }
    // Transient errors → restart
    restartListening();
  });

  useSpeechRecognitionEvent('end', () => {
    if (!enabled) return;
    // Continuous mode "ends" when the OS times out — restart
    restartListening();
  });

  // AppState — stop when app is backgrounded, resume when foregrounded
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (prev === 'active' && nextState !== 'active') {
        stopListening();
      } else if (prev !== 'active' && nextState === 'active' && enabled) {
        startListening();
      }
    });
    return () => sub.remove();
  }, [enabled, startListening, stopListening]);

  // Main enable/disable effect
  useEffect(() => {
    isMountedRef.current = true;
    if (enabled) {
      startListening();
    } else {
      stopListening();
    }
    return () => {
      isMountedRef.current = false;
      clearTimers();
      if (ExpoSpeechRecognitionModule) {
        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {
          /* ignore */
        }
      }
    };
  }, [enabled, startListening, stopListening, clearTimers]);

  return { isActive, lastHeard };
}
