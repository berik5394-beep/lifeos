import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { storage } from '@/services/storage';
import { getPreferredVoiceIdentifier } from '@/hooks/use-voice';
import { createVAD, type VADInstance } from '@/services/vad';
import {
  openWhatsApp,
  openMapsRoute,
  openTelegram,
  openSMS,
  makeCall,
  openTaxi,
  openURL,
} from '@/services/deep-links';
import { scheduleAlarmNotification } from '@/services/alarm-notifications';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export type ConversationMode = 'push-to-talk' | 'continuous';

export type ConversationState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'confirming';

interface ClientAction {
  type: string;
  phone?: string;
  text?: string;
  destination?: string;
  mode?: 'driving' | 'transit' | 'walking';
  username?: string;
  url?: string;
  title?: string;
  triggerDate?: string;
  body?: string;
  screen?: string;
  params?: Record<string, unknown>;
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  action?: { status: 'success' | 'error'; message: string };
}

interface ConversationSession {
  sessionId: string;
  messages: ConversationMessage[];
}

interface StartResponse {
  sessionId: string;
  greeting: string;
  suggestions?: string[];
}

interface MessageResponse {
  text?: string;
  response?: string;
  transcription?: string;
  suggestions?: string[];
  clientAction?: ClientAction;
  actions?: Array<{ tool: string; status: string; clientAction?: ClientAction }>;
  done?: boolean;
}

export interface UseVoiceConversationReturn {
  state: ConversationState;
  mode: ConversationMode;
  session: ConversationSession | null;
  currentText: string;
  isThinking: boolean;
  suggestions: string[];
  amplitude: number;
  startConversation: (mode?: ConversationMode) => Promise<void>;
  stopListening: () => Promise<void>;
  endConversation: () => void;
  sendText: (text: string) => Promise<void>;
  sendSuggestion: (text: string) => Promise<void>;
  toggleMode: () => void;
}

// ----------------------------------------------------------------
// End-phrase detection
// ----------------------------------------------------------------

const STOP_PHRASES = [
  'стоп',
  'хватит',
  'выключись',
  'замолчи',
  'тихо',
  'отключись',
  'всё хватит',
  'стоп лайфос',
];

function isStopPhrase(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return STOP_PHRASES.some((p) => lower.includes(p));
}

const END_PHRASES = [
  'спасибо',
  'пока',
  'отбой',
  'до свидания',
  'спокойной ночи',
  'всё',
  'хватит',
  'конец',
];

function isEndPhrase(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return END_PHRASES.some((p) => lower === p || lower.startsWith(p));
}

// ----------------------------------------------------------------
// Hook
// ----------------------------------------------------------------

let msgIdCounter = 0;
function nextMsgId(): string {
  msgIdCounter += 1;
  return `msg_${Date.now()}_${msgIdCounter}`;
}

/**
 * Extract usable text from server response.
 * Server returns `response` field for /text and /message endpoints,
 * and `greeting` for /start. We normalize here.
 */
function extractResponseText(data: MessageResponse): string {
  return data.response || data.text || '';
}

/**
 * Extract client actions from server response.
 * Can come as `clientAction` directly or inside `actions` array.
 */
function extractClientActions(data: MessageResponse): ClientAction[] {
  const result: ClientAction[] = [];
  if (data.clientAction) {
    result.push(data.clientAction);
  }
  if (data.actions) {
    for (const a of data.actions) {
      if (a.clientAction) {
        result.push(a.clientAction);
      }
    }
  }
  return result;
}

export function useVoiceConversation(): UseVoiceConversationReturn {
  const navigation = useNavigation<any>();
  const [state, setState] = useState<ConversationState>('idle');
  const [mode, setMode] = useState<ConversationMode>('push-to-talk');
  const [session, setSession] = useState<ConversationSession | null>(null);
  const [currentText, setCurrentText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [amplitude, setAmplitude] = useState(0);
  const modeRef = useRef<ConversationMode>('push-to-talk');

  const recordingRef = useRef<Audio.Recording | null>(null);
  const vadRef = useRef<VADInstance | null>(null);
  const startListeningRef = useRef<(() => Promise<void>) | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const sessionIdRef = useRef<string | null>(null);
  const stateRef = useRef<ConversationState>('idle');

  // Keep refs in sync for use inside callbacks
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearIdleTimers();
      Speech.stop();
      cleanupRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- helpers ----

  const getToken = useCallback((): string | undefined => {
    return useAuthStore.getState().token ?? undefined;
  }, []);

  const clearIdleTimers = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
  }, []);

  const addMessage = useCallback(
    (role: 'user' | 'assistant', text: string, action?: ConversationMessage['action']) => {
      const msg: ConversationMessage = {
        id: nextMsgId(),
        role,
        text,
        timestamp: Date.now(),
        action,
      };
      setSession((prev) => {
        if (!prev) return prev;
        return { ...prev, messages: [...prev.messages, msg] };
      });
    },
    [],
  );

  const addAssistantMessage = useCallback(
    (text: string, action?: ConversationMessage['action']) => {
      addMessage('assistant', text, action);
    },
    [addMessage],
  );

  const addUserMessage = useCallback(
    (text: string) => {
      addMessage('user', text);
    },
    [addMessage],
  );

  const speakText = useCallback(async (text: string) => {
    try {
      const voiceId = await getPreferredVoiceIdentifier();
      await new Promise<void>((resolve) => {
        Speech.speak(text, {
          language: 'ru-RU',
          rate: 1.05,
          voice: voiceId,
          onDone: resolve,
          onError: () => resolve(),
          onStopped: () => resolve(),
        });
      });
    } catch {
      // TTS is non-critical
    }
  }, []);

  const cleanupRecording = useCallback(async () => {
    // Stop VAD first
    if (vadRef.current) {
      vadRef.current.stop();
      vadRef.current = null;
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
    setAmplitude(0);
  }, []);

  // ---- idle timers (reset on each interaction) ----

  const resetIdleTimers = useCallback(() => {
    clearIdleTimers();

    if (modeRef.current === 'continuous') {
      // In continuous mode — much longer timeouts, AI stays alive
      // 2 min warning
      warningTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current || stateRef.current === 'idle') return;
        addAssistantMessage('Я всё ещё слушаю, если что.');
        speakText('Я всё ещё слушаю, если что.');
      }, 120_000);

      // 5 min auto-end
      idleTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current || stateRef.current === 'idle') return;
        addAssistantMessage('Пока тихо, я отключаюсь. Позови когда буду нужен!');
        speakText('Пока тихо, я отключаюсь. Позови когда буду нужен!').then(() => {
          if (isMountedRef.current) doEndConversation();
        });
      }, 300_000);
    } else {
      // Push-to-talk mode — original short timers
      // 30s warning
      warningTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current || stateRef.current === 'idle') return;
        addAssistantMessage('Ты ещё здесь?');
        speakText('Ты ещё здесь?');
      }, 30_000);

      // 60s auto-end
      idleTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current || stateRef.current === 'idle') return;
        doEndConversation();
      }, 60_000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- client action handling ----

  const handleClientAction = useCallback(async (action: ClientAction) => {
    try {
      switch (action.type) {
        case 'open_whatsapp':
          if (action.phone) await openWhatsApp(action.phone, action.text ?? '');
          break;
        case 'open_maps':
          if (action.destination) await openMapsRoute(action.destination, action.mode ?? 'driving');
          break;
        case 'open_telegram':
          if (action.username) await openTelegram(action.username, action.text);
          break;
        case 'send_sms':
          if (action.phone) await openSMS(action.phone, action.text ?? '');
          break;
        case 'make_call':
          if (action.phone) await makeCall(action.phone);
          break;
        case 'open_taxi':
          if (action.destination) await openTaxi(action.destination);
          break;
        case 'open_url':
          if (action.url) await openURL(action.url);
          break;
        case 'set_alarm':
          if (action.triggerDate) {
            await scheduleAlarmNotification({
              title: action.title ?? 'LifeOS',
              body: action.body ?? 'Напоминание',
              triggerDate: new Date(action.triggerDate),
            });
          }
          break;
        case 'navigate':
          if (action.screen) {
            navigation.navigate(action.screen as never, (action.params ?? {}) as never);
          }
          break;
        default:
          break;
      }
    } catch {
      // Action failures are non-critical
    }
  }, [navigation]);

  // ---- process response from server ----

  const processResponse = useCallback(
    async (data: MessageResponse) => {
      if (!isMountedRef.current) return;

      const text = extractResponseText(data);
      setCurrentText(text);
      if (text) {
        addAssistantMessage(text);
      }
      setSuggestions(data.suggestions ?? []);

      // Add user's transcription if present (from audio messages)
      if (data.transcription) {
        // Insert user message before assistant response
        addUserMessage(data.transcription);
      }

      // Handle client actions
      const clientActions = extractClientActions(data);
      for (const action of clientActions) {
        await handleClientAction(action);
        addAssistantMessage('', {
          status: 'success',
          message: 'Действие выполнено',
        });
      }

      // Speak the response, then wait for next input
      if (text) {
        setState('speaking');
        await speakText(text);
      }

      if (!isMountedRef.current) return;

      if (data.done || (text && isEndPhrase(text))) {
        doEndConversation();
        return;
      }

      // In continuous mode — auto-restart listening after AI finishes speaking
      if (modeRef.current === 'continuous') {
        // Small pause so user can process the response
        await new Promise((r) => setTimeout(r, 500));
        if (isMountedRef.current && stateRef.current !== 'idle') {
          startListeningRef.current?.();
        }
      } else {
        setState('confirming');
        resetIdleTimers();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addAssistantMessage, addUserMessage, handleClientAction, speakText, resetIdleTimers],
  );

  // ---- send recorded audio to server ----

  const sendAudioToServer = useCallback(
    async (uri: string) => {
      setState('processing');
      setAmplitude(0);

      try {
        const base64Audio = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        if (!base64Audio || base64Audio.length < 200) {
          addAssistantMessage('', {
            status: 'error',
            message: 'Запись слишком короткая',
          });
          setState('confirming');
          resetIdleTimers();
          return;
        }

        const token = getToken();
        const data = await api.post<MessageResponse>(
          '/voice/conversation/message',
          {
            sessionId: sessionIdRef.current,
            audio: base64Audio,
            format: Platform.OS === 'ios' ? 'm4a' : 'm4a',
          },
          token,
        );

        const text = extractResponseText(data);

        // Check if user said a stop phrase (continuous mode)
        if (data.transcription && isStopPhrase(data.transcription)) {
          addUserMessage(data.transcription);
          const farewell = 'Окей, отключаюсь. Позови когда буду нужен!';
          addAssistantMessage(farewell);
          setState('speaking');
          await speakText(farewell);
          if (isMountedRef.current) doEndConversation();
          return;
        }

        if (text) {
          // Add user transcription before processing response
          if (data.transcription) {
            addUserMessage(data.transcription);
          }
          await processResponse(data);
        } else {
          // In continuous mode, silently restart listening on empty recognition
          if (modeRef.current === 'continuous') {
            await new Promise((r) => setTimeout(r, 300));
            if (isMountedRef.current && stateRef.current !== 'idle') {
              startListeningRef.current?.();
            }
            return;
          }
          addAssistantMessage('', {
            status: 'error',
            message: 'Не удалось распознать речь',
          });
          setState('confirming');
          resetIdleTimers();
        }
      } catch {
        if (isMountedRef.current) {
          addAssistantMessage('', {
            status: 'error',
            message: 'Ошибка обработки голоса',
          });
          setState('confirming');
          resetIdleTimers();
        }
      } finally {
        FileSystem.deleteAsync(uri).catch(() => {});
      }
    },
    [getToken, addAssistantMessage, processResponse, resetIdleTimers],
  );

  // ---- start conversation ----

  const startConversation = useCallback(async (startMode: ConversationMode = 'push-to-talk') => {
    if (stateRef.current !== 'idle') return;

    setMode(startMode);
    modeRef.current = startMode;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    setState('processing');
    setCurrentText('');
    setSuggestions([]);

    const assistantStyle = storage.getString('assistantStyle') ?? 'friendly';
    const token = getToken();

    try {
      const data = await api.post<StartResponse>(
        '/voice/conversation/start',
        { style: assistantStyle },
        token,
      );

      if (!isMountedRef.current) return;

      sessionIdRef.current = data.sessionId;
      setSession({
        sessionId: data.sessionId,
        messages: [],
      });

      const greeting = data.greeting || 'Привет! Чем могу помочь?';
      addAssistantMessage(greeting);
      setCurrentText(greeting);
      setSuggestions(data.suggestions ?? []);

      setState('speaking');
      await speakText(greeting);

      if (!isMountedRef.current) return;

      // In continuous mode — start listening immediately after greeting
      if (modeRef.current === 'continuous') {
        await new Promise((r) => setTimeout(r, 300));
        if (isMountedRef.current) startListeningRef.current?.();
      } else {
        setState('confirming');
        resetIdleTimers();
      }
    } catch {
      if (!isMountedRef.current) return;
      // Fallback: start locally without server
      sessionIdRef.current = `local_${Date.now()}`;
      setSession({
        sessionId: sessionIdRef.current,
        messages: [],
      });

      const fallbackGreeting = 'Привет! Чем могу помочь?';
      addAssistantMessage(fallbackGreeting);
      setCurrentText(fallbackGreeting);
      setSuggestions([
        'Планы на сегодня',
        'Как у меня с бюджетом?',
        'Мотивируй меня',
      ]);

      setState('speaking');
      await speakText(fallbackGreeting);

      if (!isMountedRef.current) return;
      if (modeRef.current === 'continuous') {
        await new Promise((r) => setTimeout(r, 300));
        if (isMountedRef.current) startListeningRef.current?.();
      } else {
        setState('confirming');
        resetIdleTimers();
      }
    }
  }, [getToken, addAssistantMessage, speakText, resetIdleTimers]);

  // ---- start listening (record audio with VAD) ----

  const startListening = useCallback(async () => {
    clearIdleTimers();
    setState('listening');
    setAmplitude(0);

    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        addAssistantMessage('', {
          status: 'error',
          message: 'Нет разрешения на микрофон',
        });
        setState('confirming');
        resetIdleTimers();
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      // ── Start VAD monitoring ──────────────────────────────────────
      vadRef.current = createVAD(recording, {
        onSpeechEnd: async () => {
          // VAD detected end of speech — auto-stop and send
          if (!isMountedRef.current) return;
          if (stateRef.current !== 'listening') return;

          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

          const rec = recordingRef.current;
          recordingRef.current = null;
          vadRef.current = null;
          let uri: string | null = null;

          try {
            if (rec) {
              const status = await rec.getStatusAsync();
              if (status.isRecording || status.canRecord) {
                await rec.stopAndUnloadAsync();
              }
              uri = rec.getURI();
            }
          } catch {
            /* ignore */
          }

          try {
            await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
          } catch {
            /* ignore */
          }

          if (uri) {
            await sendAudioToServer(uri);
          } else {
            setState('confirming');
            resetIdleTimers();
          }
        },
        onAmplitude: (amp) => {
          if (isMountedRef.current) {
            setAmplitude(amp);
          }
        },
        onStatusChange: (_isSpeaking) => {
          // Could be used for visual feedback if needed
        },
      });
    } catch {
      addAssistantMessage('', {
        status: 'error',
        message: 'Не удалось начать запись',
      });
      setState('confirming');
      resetIdleTimers();
    }
  }, [clearIdleTimers, addAssistantMessage, resetIdleTimers, sendAudioToServer]);

  // Keep ref in sync for use in processResponse callback
  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  // ---- stop listening manually (also triggers send) ----

  const stopListeningManual = useCallback(async () => {
    if (stateRef.current !== 'listening' || !recordingRef.current) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    // Stop VAD
    if (vadRef.current) {
      vadRef.current.stop();
      vadRef.current = null;
    }

    const recording = recordingRef.current;
    recordingRef.current = null;
    let uri: string | null = null;

    try {
      const status = await recording.getStatusAsync();
      if (status.isRecording || status.canRecord) {
        await recording.stopAndUnloadAsync();
      }
      uri = recording.getURI();
    } catch {
      /* ignore */
    }

    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {
      /* ignore */
    }

    if (uri) {
      await sendAudioToServer(uri);
    } else {
      addAssistantMessage('', {
        status: 'error',
        message: 'Не удалось получить запись',
      });
      setState('confirming');
      resetIdleTimers();
    }
  }, [sendAudioToServer, addAssistantMessage, resetIdleTimers]);

  // ---- send text message ----

  const sendText = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      clearIdleTimers();
      addUserMessage(text.trim());
      setState('processing');

      // Check for stop phrases (continuous mode)
      if (isStopPhrase(text)) {
        const farewell = 'Окей, отключаюсь. Позови когда буду нужен!';
        addAssistantMessage(farewell);
        setState('speaking');
        await speakText(farewell);
        if (isMountedRef.current) doEndConversation();
        return;
      }

      // Check for end phrases
      if (isEndPhrase(text)) {
        const farewell = 'До встречи! Удачного дня!';
        addAssistantMessage(farewell);
        setState('speaking');
        await speakText(farewell);
        if (isMountedRef.current) {
          doEndConversation();
        }
        return;
      }

      try {
        const token = getToken();
        const data = await api.post<MessageResponse>(
          '/voice/conversation/text',
          {
            sessionId: sessionIdRef.current,
            text: text.trim(),
          },
          token,
        );

        await processResponse(data);
      } catch {
        if (isMountedRef.current) {
          addAssistantMessage('', {
            status: 'error',
            message: 'Ошибка соединения с сервером',
          });
          setState('confirming');
          resetIdleTimers();
        }
      }
    },
    [
      clearIdleTimers,
      addUserMessage,
      getToken,
      processResponse,
      addAssistantMessage,
      speakText,
      resetIdleTimers,
    ],
  );

  const sendSuggestion = useCallback(
    async (text: string) => {
      await sendText(text);
    },
    [sendText],
  );

  // ---- end conversation ----

  const doEndConversation = useCallback(() => {
    clearIdleTimers();
    Speech.stop();
    cleanupRecording();

    // Notify server (fire-and-forget)
    if (sessionIdRef.current) {
      const token = getToken();
      api
        .post('/voice/conversation/end', { sessionId: sessionIdRef.current }, token)
        .catch(() => {});
    }

    sessionIdRef.current = null;
    setState('idle');
    setSession(null);
    setCurrentText('');
    setSuggestions([]);
    setAmplitude(0);
  }, [clearIdleTimers, cleanupRecording, getToken]);

  const endConversation = useCallback(() => {
    doEndConversation();
  }, [doEndConversation]);

  // ---- toggle listening (for mic button) ----
  const toggleListening = useCallback(async () => {
    if (stateRef.current === 'listening') {
      await stopListeningManual();
    } else if (stateRef.current === 'confirming' || stateRef.current === 'speaking') {
      Speech.stop();
      await startListening();
    }
  }, [stopListeningManual, startListening]);

  // ---- toggle mode ----
  const toggleMode = useCallback(() => {
    const newMode: ConversationMode = modeRef.current === 'push-to-talk' ? 'continuous' : 'push-to-talk';
    setMode(newMode);
    modeRef.current = newMode;

    if (newMode === 'continuous' && stateRef.current === 'confirming') {
      // Switch to continuous — start listening immediately
      startListening();
    }
  }, [startListening]);

  const isThinking = state === 'processing';

  return {
    state,
    mode,
    session,
    currentText,
    isThinking,
    suggestions,
    amplitude,
    startConversation,
    stopListening: toggleListening,
    endConversation,
    sendText,
    sendSuggestion,
    toggleMode,
  };
}
