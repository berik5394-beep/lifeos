import { useCallback, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

/**
 * JARVIS-стиль диктофон: юзер нажимает кнопку → говорит свободно → нажимает
 * "стоп" → сервер транскрибирует + извлекает задачи + запоминает факты + говорит
 * подтверждение вслух.
 *
 * Использует тот же expo-av Audio.Recording что и use-voice, но:
 *  - длиннее (до 5 минут)
 *  - НЕ парсит как команду; шлёт на /dictation/process (Groq + Claude в одном)
 *  - озвучивает spokenResponse через expo-speech по завершении
 *
 * Состояния:
 *  idle → recording → processing → result/error
 */

interface CreatedTask {
  id: string;
  title: string;
  date: string;
  time?: string | null;
  category?: string;
}

interface CreatedMemory {
  id: string;
  type: string;
  content: string;
  importance: number;
  tags?: string[];
}

export interface DictationResult {
  sessionId: string;
  transcript: string;
  summary: string;
  spokenResponse: string;
  tasksCreated: CreatedTask[];
  memoriesCreated: CreatedMemory[];
}

type DictationState = 'idle' | 'recording' | 'processing' | 'done' | 'error';

const MAX_DURATION_MS = 5 * 60 * 1000; // 5 минут лимит

export function useDictation() {
  const token = useAuthStore((s) => s.token);
  const [state, setState] = useState<DictationState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DictationResult | null>(null);
  const [durationSec, setDurationSec] = useState(0);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(async () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (recordingRef.current) {
      try {
        const status = await recordingRef.current.getStatusAsync();
        if (status.isRecording || status.canRecord) {
          await recordingRef.current.stopAndUnloadAsync();
        }
      } catch {
        /* ignore */
      }
      recordingRef.current = null;
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {
      /* ignore */
    }
  }, []);

  const start = useCallback(async () => {
    if (state === 'recording' || state === 'processing') return;
    setError(null);
    setResult(null);
    setDurationSec(0);
    try {
      // Запрос разрешения
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setError('Нужно разрешение на микрофон');
        setState('error');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      startedAtRef.current = Date.now();
      setState('recording');
      tickRef.current = setInterval(() => {
        setDurationSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 500);
      // Авто-стоп через MAX_DURATION_MS — чтобы юзер не оставил микрофон
      // включённым и не сжёг квоту Whisper/Claude огромной записью.
      autoStopRef.current = setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        stop().catch(() => {});
      }, MAX_DURATION_MS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось начать запись';
      setError(msg);
      setState('error');
      await cleanup();
    }
  }, [state, cleanup]);

  const stop = useCallback(async () => {
    if (state !== 'recording') return;
    setState('processing');
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    const rec = recordingRef.current;
    if (!rec) {
      setError('Запись не активна');
      setState('error');
      return;
    }
    let uri: string | null = null;
    try {
      await rec.stopAndUnloadAsync();
      uri = rec.getURI();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось остановить запись';
      setError(msg);
      setState('error');
      await cleanup();
      return;
    } finally {
      recordingRef.current = null;
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      } catch {
        /* ignore */
      }
    }
    if (!uri) {
      setError('Файл записи не найден');
      setState('error');
      return;
    }
    try {
      // expo-file-system 19 переехал на новые API; readAsStringAsync —
      // legacy-функция, EncodingType больше не на корневом экспорте.
      // Передаём 'base64' как строковой литерал (поддерживается типами).
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });
      const duration = Math.floor((Date.now() - startedAtRef.current) / 1000);
      const data = await api.post<DictationResult>(
        '/dictation/process',
        { audio: base64, format: 'm4a', durationSeconds: duration },
        token,
      );
      setResult(data);
      setState('done');
      // Озвучиваем ответ JARVIS-а голосом
      if (data.spokenResponse) {
        try {
          Speech.speak(data.spokenResponse, { language: 'ru-RU' });
        } catch {
          /* ignore TTS errors */
        }
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Ошибка обработки записи';
      setError(msg);
      setState('error');
    } finally {
      // Удаляем временный файл
      if (uri) {
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {
          /* ignore */
        }
      }
    }
  }, [state, token, cleanup]);

  const cancel = useCallback(async () => {
    await cleanup();
    setState('idle');
    setError(null);
    setDurationSec(0);
  }, [cleanup]);

  const reset = useCallback(() => {
    setState('idle');
    setError(null);
    setResult(null);
    setDurationSec(0);
  }, []);

  return {
    state,
    isRecording: state === 'recording',
    isProcessing: state === 'processing',
    error,
    result,
    durationSec,
    start,
    stop,
    cancel,
    reset,
  };
}
