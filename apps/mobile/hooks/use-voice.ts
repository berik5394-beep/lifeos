import { useState, useRef, useCallback } from 'react';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

interface VoiceIntent {
  action: string;
  [key: string]: unknown;
}

interface VoiceResult {
  intent: VoiceIntent;
  response: string;
}

interface VoiceProcessResponse {
  intent: VoiceIntent;
  response: string;
}

interface UseVoiceReturn {
  isRecording: boolean;
  isProcessing: boolean;
  lastResult: VoiceResult | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  speak: (text: string) => void;
}

// TODO: Интеграция с Whisper API для реального STT
// Сейчас используется заглушка — аудио записывается, но транскрипция мокнута.
// В будущем: отправить аудио файл на сервер → Whisper API → получить текст.
function mockTranscribe(_uri: string): string {
  return 'Покажи сводку за сегодня';
}

export function useVoice(): UseVoiceReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<VoiceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const token = useAuthStore((state) => state.token);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setLastResult(null);

      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        setError('Нет разрешения на запись аудио');
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
      setIsRecording(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка начала записи';
      setError(message);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      const recording = recordingRef.current;
      if (!recording) {
        return;
      }

      setIsRecording(false);
      setIsProcessing(true);

      await recording.stopAndUnloadAsync();

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });

      const uri = recording.getURI();
      recordingRef.current = null;

      if (!uri) {
        setError('Не удалось получить запись');
        setIsProcessing(false);
        return;
      }

      // TODO: Заменить mockTranscribe на реальный вызов Whisper API
      // const formData = new FormData();
      // formData.append('audio', { uri, type: 'audio/m4a', name: 'recording.m4a' });
      // const { text } = await api.post<{ text: string }>('/voice/transcribe', formData, token);
      const transcribedText = mockTranscribe(uri);

      const result = await api.post<VoiceProcessResponse>(
        '/voice/process',
        { text: transcribedText },
        token ?? undefined,
      );

      const voiceResult: VoiceResult = {
        intent: result.intent,
        response: result.response,
      };

      setLastResult(voiceResult);
      speak(voiceResult.response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка обработки голоса';
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [token]);

  const speak = useCallback((text: string) => {
    Speech.speak(text, { language: 'ru' });
  }, []);

  return {
    isRecording,
    isProcessing,
    lastResult,
    error,
    startRecording,
    stopRecording,
    speak,
  };
}
