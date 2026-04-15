# LifeOS J.A.R.V.I.S. — Полная техническая спецификация

## Обзор

LifeOS превращается из трекера привычек в **AI-операционную систему жизни** с голосовым управлением, глубокой интеграцией с телефоном и проактивным интеллектом. Пользователь разговаривает с LifeOS как с живым ассистентом — LifeOS слушает, думает, задаёт уточняющие вопросы, выполняет цепочки действий и говорит в ответ.

**Ключевая метафора:** J.A.R.V.I.S. из Iron Man — AI, который понимает контекст, предвосхищает потребности и действует.

**Стек (дополнения к существующему):**
- expo-av (запись аудио) — уже есть
- expo-speech (TTS) — уже есть
- expo-calendar (системный календарь) — новое
- expo-contacts (контакты телефона) — новое
- expo-linking (открытие WhatsApp, 2GIS, Uber и т.д.) — новое
- Groq Whisper API (STT, ~300ms) — уже есть
- Claude API с tool_use (function calling) — расширение
- Google Maps Directions API — новое
- Aviasales/Kiwi.com API (авиабилеты) — новое
- OpenWeatherMap API (погода) — новое
- Exchange Rates API (валюты) — новое

---

## ЧАСТЬ 1: VOICE CONVERSATION ENGINE (Голосовой диалоговый движок)

### 1.1 Архитектура

Текущая модель: одиночная команда → одиночное действие.
Новая модель: **непрерывный диалог** с памятью, tool calling и цепочками действий.

```
┌─────────────────────────────────────────────────────────┐
│                    КЛИЕНТ (React Native)                │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐           │
│  │   IDLE   │──▶│ LISTENING│──▶│PROCESSING│           │
│  └──────────┘   └──────────┘   └──────────┘           │
│       ▲                              │                  │
│       │              ┌───────────────┘                  │
│       │              ▼                                  │
│       │         ┌──────────┐                            │
│       │◀────────│ SPEAKING │──▶ LISTENING (цикл)       │
│       │         └──────────┘                            │
│  "Спасибо LifeOS"                                      │
│       │                                                 │
│       ▼                                                 │
│  ┌──────────┐                                          │
│  │   END    │                                          │
│  └──────────┘                                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    СЕРВЕР (Fastify)                      │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │Context       │  │Conversation  │  │Action         │ │
│  │Aggregator    │  │Manager       │  │Executor       │ │
│  │(собирает всё)│  │(Claude API)  │  │(выполняет)    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 1.2 Состояния Voice State Machine (клиент)

```typescript
// apps/mobile/types/voice.ts

export type VoiceState = 
  | 'idle'        // Ожидание активации
  | 'listening'   // Запись аудио (пользователь говорит)
  | 'processing'  // Отправка на сервер, ожидание ответа
  | 'speaking'    // TTS проигрывает ответ
  | 'confirming'; // Ожидание подтверждения действия

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ActionResult[];    // выполненные действия
  suggestions?: string[];      // кнопки-подсказки
  timestamp: number;
};

export type ConversationSession = {
  id: string;
  messages: ConversationMessage[];
  isActive: boolean;
  startedAt: number;
  context: UserContext;       // снапшот контекста при старте
};

export type ActionResult = {
  type: string;               // 'create_event', 'search_flights', etc.
  success: boolean;
  data?: any;
  message: string;            // человекочитаемое описание
};
```

### 1.3 Voice Conversation Hook (клиент)

```typescript
// apps/mobile/hooks/useVoiceConversation.ts

import { useState, useRef, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { VoiceState, ConversationMessage, ConversationSession } from '../types/voice';
import { api } from '../services/api';
import { useMMKVString } from 'react-native-mmkv';

const SILENCE_TIMEOUT_MS = 2000;       // 2 сек тишины → прекратить запись
const IDLE_TIMEOUT_MS = 30000;         // 30 сек молчания → спросить "ты здесь?"
const AUTO_END_TIMEOUT_MS = 60000;     // 60 сек → автозавершение
const END_PHRASES = [
  'спасибо лайфос', 'спасибо lifeos', 'спасибо',
  'пока', 'всё', 'хватит', 'конец', 'отбой',
];

export function useVoiceConversation() {
  const [state, setState] = useState<VoiceState>('idle');
  const [session, setSession] = useState<ConversationSession | null>(null);
  const [currentText, setCurrentText] = useState<string>('');
  const [isThinking, setIsThinking] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoEndTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // ═══════════════════════════════════════════════════
  // 1. НАЧАЛО ДИАЛОГА
  // ═══════════════════════════════════════════════════
  const startConversation = useCallback(async () => {
    // Создаём сессию на сервере — он собирает контекст
    const { data } = await api.post('/voice/conversation/start');
    sessionIdRef.current = data.sessionId;

    setSession({
      id: data.sessionId,
      messages: [],
      isActive: true,
      startedAt: Date.now(),
      context: data.context,
    });

    // Если есть приветствие (утренний сценарий)
    if (data.greeting) {
      await speakAndListen(data.greeting, data.suggestions);
    } else {
      startListening();
    }
  }, []);

  // ═══════════════════════════════════════════════════
  // 2. ЗАПИСЬ АУДИО
  // ═══════════════════════════════════════════════════
  const startListening = useCallback(async () => {
    setState('listening');
    resetIdleTimer();

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    await recording.startAsync();
    recordingRef.current = recording;

    // Мониторим уровень звука для VAD (Voice Activity Detection)
    recording.setOnRecordingStatusUpdate((status) => {
      if (status.isRecording && status.metering !== undefined) {
        // Если тишина > SILENCE_TIMEOUT_MS → остановить запись
        // Реализуется через отслеживание dB уровня
        handleMetering(status.metering);
      }
    });
  }, []);

  const stopListening = useCallback(async () => {
    if (!recordingRef.current) return;

    await recordingRef.current.stopAndUnloadAsync();
    const uri = recordingRef.current.getURI();
    recordingRef.current = null;

    if (!uri) return;

    setState('processing');
    setIsThinking(true);

    try {
      // Отправляем аудио на сервер для обработки
      const formData = new FormData();
      formData.append('audio', {
        uri,
        type: 'audio/m4a',
        name: 'voice.m4a',
      } as any);
      formData.append('sessionId', sessionIdRef.current!);

      const { data } = await api.post('/voice/conversation/message', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
      });

      setIsThinking(false);

      // Проверяем: пользователь хочет завершить?
      if (data.endConversation) {
        await speakAndEnd(data.response);
        return;
      }

      // Обновляем историю
      setSession(prev => prev ? {
        ...prev,
        messages: [
          ...prev.messages,
          { id: data.userMsgId, role: 'user', content: data.userText, timestamp: Date.now() },
          { id: data.assistantMsgId, role: 'assistant', content: data.response,
            actions: data.actions, suggestions: data.suggestions, timestamp: Date.now() },
        ],
      } : null);

      // Говорим ответ и снова слушаем
      await speakAndListen(data.response, data.suggestions);

    } catch (err) {
      setIsThinking(false);
      await speakAndListen('Извини, произошла ошибка. Повтори, пожалуйста.', []);
    }
  }, []);

  // ═══════════════════════════════════════════════════
  // 3. TTS + ВОЗВРАТ К ПРОСЛУШИВАНИЮ
  // ═══════════════════════════════════════════════════
  const speakAndListen = useCallback(async (text: string, suggestions?: string[]) => {
    setState('speaking');
    setCurrentText(text);

    await new Promise<void>((resolve) => {
      Speech.speak(text, {
        language: 'ru-RU',
        rate: 1.05,
        onDone: () => resolve(),
        onError: () => resolve(),
      });
    });

    // После TTS — снова слушаем (ЦИКЛ!)
    startListening();
  }, []);

  const speakAndEnd = useCallback(async (text: string) => {
    setState('speaking');
    setCurrentText(text);

    await new Promise<void>((resolve) => {
      Speech.speak(text, {
        language: 'ru-RU',
        rate: 1.05,
        onDone: () => resolve(),
        onError: () => resolve(),
      });
    });

    endConversation();
  }, []);

  // ═══════════════════════════════════════════════════
  // 4. ЗАВЕРШЕНИЕ ДИАЛОГА
  // ═══════════════════════════════════════════════════
  const endConversation = useCallback(() => {
    setState('idle');
    clearTimers();
    if (sessionIdRef.current) {
      api.post('/voice/conversation/end', { sessionId: sessionIdRef.current }).catch(() => {});
    }
    sessionIdRef.current = null;
    setSession(null);
    setCurrentText('');
  }, []);

  // ═══════════════════════════════════════════════════
  // 5. ТЕКСТОВЫЙ ВВОД (альтернатива голосу)
  // ═══════════════════════════════════════════════════
  const sendText = useCallback(async (text: string) => {
    if (!sessionIdRef.current) {
      await startConversation();
    }

    setState('processing');
    setIsThinking(true);

    const { data } = await api.post('/voice/conversation/text', {
      sessionId: sessionIdRef.current,
      text,
    });

    setIsThinking(false);

    if (data.endConversation) {
      await speakAndEnd(data.response);
      return;
    }

    setSession(prev => prev ? {
      ...prev,
      messages: [
        ...prev.messages,
        { id: data.userMsgId, role: 'user', content: text, timestamp: Date.now() },
        { id: data.assistantMsgId, role: 'assistant', content: data.response,
          actions: data.actions, suggestions: data.suggestions, timestamp: Date.now() },
      ],
    } : null);

    await speakAndListen(data.response, data.suggestions);
  }, []);

  // ═══════════════════════════════════════════════════
  // 6. БЫСТРЫЕ КНОПКИ (suggestions / chips)
  // ═══════════════════════════════════════════════════
  const sendSuggestion = useCallback(async (text: string) => {
    await sendText(text);
  }, [sendText]);

  // ═══════════════════════════════════════════════════
  // ТАЙМЕРЫ
  // ═══════════════════════════════════════════════════
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (autoEndTimerRef.current) clearTimeout(autoEndTimerRef.current);

    idleTimerRef.current = setTimeout(() => {
      speakAndListen('Берик, ты ещё здесь? Если всё — скажи спасибо.');
    }, IDLE_TIMEOUT_MS);

    autoEndTimerRef.current = setTimeout(() => {
      speakAndEnd('Похоже, ты занят. Закрываю диалог. Позови когда понадоблюсь!');
    }, AUTO_END_TIMEOUT_MS);
  }, []);

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (autoEndTimerRef.current) clearTimeout(autoEndTimerRef.current);
  }, []);

  // VAD: простой порог по dB
  const silenceStart = useRef<number>(0);
  const handleMetering = useCallback((dB: number) => {
    const SILENCE_THRESHOLD = -40; // dB
    if (dB < SILENCE_THRESHOLD) {
      if (!silenceStart.current) silenceStart.current = Date.now();
      if (Date.now() - silenceStart.current > SILENCE_TIMEOUT_MS) {
        stopListening();
      }
    } else {
      silenceStart.current = 0;
    }
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      clearTimers();
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  return {
    state,
    session,
    currentText,
    isThinking,
    startConversation,
    startListening,
    stopListening,
    endConversation,
    sendText,
    sendSuggestion,
  };
}
```

### 1.4 Voice Conversation UI (клиент)

```typescript
// apps/mobile/components/voice/VoiceConversationScreen.tsx

import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Animated, Dimensions, SafeAreaView,
} from 'react-native';
import { useVoiceConversation } from '../../hooks/useVoiceConversation';
import { colors, spacing, fontSize, borderRadius } from '../../constants/colors';
import { MicrophoneIcon, XIcon } from '../../components/ui/Icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function VoiceConversationScreen() {
  const {
    state, session, currentText, isThinking,
    startConversation, stopListening, endConversation,
    sendSuggestion,
  } = useVoiceConversation();

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef<ScrollView>(null);

  // Пульсация микрофона при прослушивании
  useEffect(() => {
    if (state === 'listening') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [state]);

  // Автоскролл вниз при новых сообщениях
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [session?.messages.length]);

  // ─── Начальный экран (IDLE) ─────────────────────
  if (state === 'idle') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.idleContainer}>
          <Text style={styles.idleTitle}>Привет, я LifeOS</Text>
          <Text style={styles.idleSubtitle}>Нажми на микрофон или скажи «Привет LifeOS»</Text>
          <TouchableOpacity style={styles.bigMicButton} onPress={startConversation}>
            <MicrophoneIcon size={48} color={colors.text} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Активный диалог ────────────────────────────
  const lastAssistantMsg = session?.messages.filter(m => m.role === 'assistant').pop();

  return (
    <SafeAreaView style={styles.container}>
      {/* Заголовок */}
      <View style={styles.header}>
        <View style={styles.statusDot(state)} />
        <Text style={styles.statusText}>
          {state === 'listening' ? 'Слушаю...' :
           state === 'processing' ? 'Думаю...' :
           state === 'speaking' ? 'Говорю...' : ''}
        </Text>
        <TouchableOpacity onPress={endConversation}>
          <XIcon size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* История сообщений */}
      <ScrollView ref={scrollRef} style={styles.messagesContainer}>
        {session?.messages.map((msg) => (
          <View key={msg.id} style={[
            styles.messageBubble,
            msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
          ]}>
            <Text style={[
              styles.messageText,
              msg.role === 'user' ? styles.userText : styles.assistantText,
            ]}>
              {msg.content}
            </Text>

            {/* Выполненные действия */}
            {msg.actions?.map((action, i) => (
              <View key={i} style={styles.actionBadge}>
                <Text style={styles.actionText}>
                  {action.success ? '✅' : '❌'} {action.message}
                </Text>
              </View>
            ))}
          </View>
        ))}

        {/* Индикатор "думает" */}
        {isThinking && (
          <View style={[styles.messageBubble, styles.assistantBubble]}>
            <Text style={styles.thinkingText}>●●●</Text>
          </View>
        )}
      </ScrollView>

      {/* Кнопки-подсказки (suggestions) */}
      {lastAssistantMsg?.suggestions && lastAssistantMsg.suggestions.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsRow}>
          {lastAssistantMsg.suggestions.map((s, i) => (
            <TouchableOpacity key={i} style={styles.suggestionChip} onPress={() => sendSuggestion(s)}>
              <Text style={styles.suggestionText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Кнопка микрофона */}
      <View style={styles.bottomControls}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={[
              styles.micButton,
              state === 'listening' && styles.micButtonActive,
            ]}
            onPress={state === 'listening' ? stopListening : undefined}
          >
            <MicrophoneIcon
              size={32}
              color={state === 'listening' ? colors.danger : colors.text}
            />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // ... остальные стили в дизайн-системе LifeOS
  idleContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  idleTitle: { fontSize: fontSize.xxl, color: colors.text, fontWeight: '700', marginBottom: spacing.sm },
  idleSubtitle: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
  bigMicButton: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 20,
  },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  statusDot: (state: string) => ({
    width: 10, height: 10, borderRadius: 5, marginRight: spacing.sm,
    backgroundColor: state === 'listening' ? colors.danger : state === 'processing' ? colors.warning : colors.success,
  }),
  statusText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  messagesContainer: { flex: 1, padding: spacing.md },
  messageBubble: { maxWidth: '80%', padding: spacing.md, borderRadius: borderRadius.lg, marginBottom: spacing.sm },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  messageText: { fontSize: fontSize.md },
  userText: { color: colors.text },
  assistantText: { color: colors.text },
  actionBadge: { marginTop: spacing.xs, padding: spacing.xs, backgroundColor: colors.surfaceLight, borderRadius: borderRadius.sm },
  actionText: { fontSize: fontSize.xs, color: colors.textSecondary },
  thinkingText: { fontSize: fontSize.lg, color: colors.textSecondary },
  suggestionsRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  suggestionChip: { backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: borderRadius.xl, marginRight: spacing.sm, borderWidth: 1, borderColor: colors.border },
  suggestionText: { fontSize: fontSize.sm, color: colors.text },
  bottomControls: { alignItems: 'center', paddingVertical: spacing.lg },
  micButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  micButtonActive: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.danger },
});
```

---

## ЧАСТЬ 2: СЕРВЕРНАЯ ЧАСТЬ — CONVERSATION ENGINE

### 2.1 Conversation Routes

```typescript
// packages/server/src/routes/conversation.ts

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticate } from '../middleware/auth';
import { processConversationMessage, buildInitialContext } from '../services/conversation-engine';
import { transcribeAudio } from '../services/transcription';

export default async function conversationRoutes(app: FastifyInstance) {

  // ═══════════════════════════════════════════════════
  // POST /voice/conversation/start — начать диалог
  // ═══════════════════════════════════════════════════
  app.post('/voice/conversation/start', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.user.sub;

    // Собираем ВЕСЬ контекст пользователя
    const context = await buildInitialContext(userId);

    // Создаём сессию в БД
    const session = await prisma.conversationSession.create({
      data: {
        userId,
        contextSnapshot: context as any, // JSON
        status: 'active',
      },
    });

    // Утреннее приветствие (если первый запуск за день)
    const greeting = await generateGreeting(userId, context);

    return reply.send({
      sessionId: session.id,
      context,
      greeting: greeting?.text ?? null,
      suggestions: greeting?.suggestions ?? [
        '📋 Планы на сегодня',
        '📅 Ближайшие встречи',
        '💰 Как с бюджетом?',
        '🔥 Мотивируй меня',
      ],
    });
  });

  // ═══════════════════════════════════════════════════
  // POST /voice/conversation/message — голосовое сообщение
  // ═══════════════════════════════════════════════════
  app.post('/voice/conversation/message', {
    preHandler: [authenticate],
    bodyLimit: 10 * 1024 * 1024, // 10MB для аудио
  }, async (request, reply) => {
    const userId = request.user.sub;
    const parts = await request.parts();

    let audioBuffer: Buffer | null = null;
    let sessionId: string = '';

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'audio') {
        audioBuffer = await part.toBuffer();
      }
      if (part.type === 'field' && part.fieldname === 'sessionId') {
        sessionId = String(part.value);
      }
    }

    if (!audioBuffer || !sessionId) {
      return reply.code(400).send({ error: 'Нужны audio и sessionId' });
    }

    // 1. STT: аудио → текст (Groq Whisper)
    const userText = await transcribeAudio(audioBuffer);

    // 2. Проверяем: фраза завершения?
    const isEnd = checkEndPhrase(userText);

    // 3. Обрабатываем через Conversation Engine
    const result = await processConversationMessage({
      sessionId,
      userId,
      userText,
      isEndRequested: isEnd,
    });

    return reply.send({
      userText,
      userMsgId: result.userMsgId,
      assistantMsgId: result.assistantMsgId,
      response: result.response,
      actions: result.actions,
      suggestions: result.suggestions,
      endConversation: result.endConversation,
    });
  });

  // ═══════════════════════════════════════════════════
  // POST /voice/conversation/text — текстовое сообщение
  // ═══════════════════════════════════════════════════
  app.post('/voice/conversation/text', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const userId = request.user.sub;
    const body = z.object({
      sessionId: z.string(),
      text: z.string().min(1).max(2000),
    }).parse(request.body);

    const isEnd = checkEndPhrase(body.text);

    const result = await processConversationMessage({
      sessionId: body.sessionId,
      userId,
      userText: body.text,
      isEndRequested: isEnd,
    });

    return reply.send({
      userText: body.text,
      userMsgId: result.userMsgId,
      assistantMsgId: result.assistantMsgId,
      response: result.response,
      actions: result.actions,
      suggestions: result.suggestions,
      endConversation: result.endConversation,
    });
  });

  // ═══════════════════════════════════════════════════
  // POST /voice/conversation/end — завершить диалог
  // ═══════════════════════════════════════════════════
  app.post('/voice/conversation/end', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const body = z.object({ sessionId: z.string() }).parse(request.body);

    await prisma.conversationSession.update({
      where: { id: body.sessionId },
      data: { status: 'ended', endedAt: new Date() },
    });

    return reply.send({ ok: true });
  });
}

// ─── Хелперы ──────────────────────────────────────
const END_PHRASES = [
  'спасибо лайфос', 'спасибо lifeos', 'спасибо', 
  'пока', 'всё', 'хватит', 'конец', 'отбой',
  'спокойной ночи', 'до свидания',
];

function checkEndPhrase(text: string): boolean {
  const normalized = text.toLowerCase().trim().replace(/[.,!?]/g, '');
  return END_PHRASES.some(phrase => normalized.includes(phrase));
}
```

### 2.2 Conversation Engine (ядро — Claude API + Tool Use)

```typescript
// packages/server/src/services/conversation-engine.ts

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../prisma';
import { executeAction, AVAILABLE_TOOLS } from './action-executor';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// ═══════════════════════════════════════════════════
// КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ — собираем всё
// ═══════════════════════════════════════════════════
export async function buildInitialContext(userId: string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay() + 1); // Понедельник
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [
    user, todayTasks, todayHabits, habitLogs,
    weeklyGoals, yearlyGoals,
    todayEvents, weekEvents,
    monthExpenses, monthIncomes, budgetLimits,
    journal, stepLog, pet,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.task.findMany({ where: { userId, date: today }, orderBy: { priority: 'desc' } }),
    prisma.habit.findMany({ where: { userId, active: true }, orderBy: { order: 'asc' } }),
    prisma.habitLog.findMany({ where: { userId, date: today } }),
    prisma.weeklyGoal.findMany({ where: { userId, weekStart: weekStart } }),
    prisma.yearlyGoal.findMany({ where: { userId, year: now.getFullYear() } }),
    prisma.calendarEvent.findMany({ where: { userId, date: today }, orderBy: { startTime: 'asc' } }),
    prisma.calendarEvent.findMany({ where: { userId, date: { gte: today, lte: weekEnd } }, orderBy: [{ date: 'asc' }, { startTime: 'asc' }] }),
    prisma.expense.findMany({ where: { userId, date: { gte: monthStart, lte: monthEnd } } }),
    prisma.income.findMany({ where: { userId, date: { gte: monthStart, lte: monthEnd } } }),
    prisma.budgetLimit.findMany({ where: { userId, month: now.getMonth() + 1, year: now.getFullYear() } }),
    prisma.journalEntry.findUnique({ where: { userId_date: { userId, date: today } } }),
    prisma.stepLog.findUnique({ where: { userId_date: { userId, date: today } } }),
    prisma.pet.findUnique({ where: { userId } }),
  ]);

  const totalMonthExpenses = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const totalMonthIncome = monthIncomes.reduce((s, i) => s + i.amount, 0);
  const totalBudgetLimit = budgetLimits.reduce((s, b) => s + b.monthlyLimit, 0);
  const completedHabitIds = new Set(habitLogs.filter(l => l.completed).map(l => l.habitId));
  const habitsCompleted = todayHabits.filter(h => completedHabitIds.has(h.id)).length;
  const tasksCompleted = todayTasks.filter(t => t.completed).length;

  return {
    user: { name: user!.name, currency: user!.currency, assistantStyle: user!.assistantStyle, assistantGender: user!.assistantGender },
    today: {
      date: today.toISOString().split('T')[0],
      dayOfWeek: ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'][now.getDay()],
      time: `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`,
    },
    tasks: {
      items: todayTasks.map(t => ({ id: t.id, title: t.title, category: t.category, priority: t.priority, time: t.time, completed: t.completed })),
      completed: tasksCompleted,
      total: todayTasks.length,
    },
    habits: {
      items: todayHabits.map(h => ({ id: h.id, name: h.name, category: h.category, completed: completedHabitIds.has(h.id) })),
      completed: habitsCompleted,
      total: todayHabits.length,
    },
    events: {
      today: todayEvents.map(e => ({ id: e.id, title: e.title, startTime: e.startTime, endTime: e.endTime, location: e.location })),
      thisWeek: weekEvents.map(e => ({ id: e.id, title: e.title, date: e.date, startTime: e.startTime, endTime: e.endTime, location: e.location })),
    },
    finance: {
      monthExpenses: totalMonthExpenses,
      monthIncome: totalMonthIncome,
      budgetLimit: totalBudgetLimit,
      budgetRemaining: totalBudgetLimit - totalMonthExpenses,
      daysLeftInMonth: monthEnd.getDate() - now.getDate(),
      byCategory: groupExpensesByCategory(monthExpenses),
    },
    goals: {
      weekly: weeklyGoals.map(g => ({ id: g.id, text: g.goalText, completed: g.completed })),
      yearly: yearlyGoals.map(g => ({ id: g.id, area: g.area, text: g.goalText, progress: g.progress })),
    },
    journal: journal ? { sleep: journal.sleepHours, energy: journal.energy, mood: journal.mood } : null,
    steps: stepLog ? { steps: stepLog.steps, distance: stepLog.distanceKm } : null,
    pet: pet ? { name: pet.name, type: pet.type, health: pet.health, level: pet.level, stage: pet.stage, isAlive: pet.isAlive, streak: pet.streak } : null,
    streak: pet?.streak ?? 0,
  };
}

function groupExpensesByCategory(expenses: { category: string; amount: number }[]) {
  const map: Record<string, number> = {};
  for (const e of expenses) map[e.category] = (map[e.category] ?? 0) + e.amount;
  return map;
}

// ═══════════════════════════════════════════════════
// СИСТЕМНЫЙ ПРОМПТ ДЛЯ CLAUDE
// ═══════════════════════════════════════════════════
function buildSystemPrompt(context: any): string {
  const style = context.user.assistantStyle;
  const name = context.user.name;
  const gender = context.user.assistantGender;

  const styleInstructions: Record<string, string> = {
    friendly: `Ты общаешься как лучший друг. Шутишь, поддерживаешь, мягко напоминаешь. 
      Используешь неформальный тон. Хвалишь за успехи конкретно.`,
    strict: `Ты строгий тренер. Требовательный, не принимаешь отмазки. 
      Хвалишь только за результат. Говоришь коротко и по делу.`,
    calm: `Ты мудрый наставник. Спокойный, рассудительный. 
      Даёшь советы без давления. Никогда не торопишь.`,
    toxic: `Ты токсичный мотиватор. Буллишь, стыдишь, саркастично издеваешься за пропуски.
      Хвалишь ОЧЕНЬ редко и скупо. Как злой друг, который говорит правду в лицо.`,
  };

  return `Ты — LifeOS, персональный AI-ассистент пользователя ${name}.
Пол ассистента: ${gender === 'female' ? 'женский' : 'мужской'}.
Стиль общения: ${styleInstructions[style] || styleInstructions.friendly}

Текущие дата/время: ${context.today.dayOfWeek}, ${context.today.date}, ${context.today.time}

═══ ПОЛНЫЙ КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ ═══

ЗАДАЧИ НА СЕГОДНЯ (${context.tasks.completed}/${context.tasks.total}):
${context.tasks.items.map((t: any) => `- [${t.completed ? '✅' : '⬜'}] ${t.title} (${t.category}, ${t.priority}${t.time ? ', ' + t.time : ''})`).join('\n') || '(нет задач)'}

ПРИВЫЧКИ (${context.habits.completed}/${context.habits.total}):
${context.habits.items.map((h: any) => `- [${h.completed ? '✅' : '⬜'}] ${h.name} (${h.category})`).join('\n') || '(нет привычек)'}

ВСТРЕЧИ СЕГОДНЯ:
${context.events.today.map((e: any) => `- ${e.startTime || '??:??'}${e.endTime ? '–' + e.endTime : ''} ${e.title}${e.location ? ' @ ' + e.location : ''}`).join('\n') || '(нет встреч)'}

ВСТРЕЧИ НА ЭТОЙ НЕДЕЛЕ:
${context.events.thisWeek.map((e: any) => `- ${e.date} ${e.startTime || ''} ${e.title}`).join('\n') || '(нет)'}

ФИНАНСЫ (этот месяц):
- Доходы: ${context.finance.monthIncome} ${context.user.currency}
- Расходы: ${context.finance.monthExpenses} ${context.user.currency}
- Лимит: ${context.finance.budgetLimit} ${context.user.currency}
- Осталось: ${context.finance.budgetRemaining} ${context.user.currency}
- Дней до конца месяца: ${context.finance.daysLeftInMonth}
- По категориям: ${JSON.stringify(context.finance.byCategory)}

ЦЕЛИ НА ГОД:
${context.goals.yearly.map((g: any) => `- ${g.area}: ${g.text} (${g.progress}%)`).join('\n') || '(нет)'}

ЦЕЛИ НА НЕДЕЛЮ:
${context.goals.weekly.map((g: any) => `- [${g.completed ? '✅' : '⬜'}] ${g.text}`).join('\n') || '(нет)'}

ДНЕВНИК: ${context.journal ? `сон ${context.journal.sleep}ч, энергия ${context.journal.energy}/10, настроение ${context.journal.mood}/10` : 'не заполнен'}
ШАГИ: ${context.steps ? `${context.steps.steps} шагов (${context.steps.distance} км)` : 'нет данных'}
ПИТОМЕЦ: ${context.pet ? `${context.pet.name} (${context.pet.type}), здоровье ${context.pet.health}%, уровень ${context.pet.level}, стадия: ${context.pet.stage}, серия: ${context.pet.streak} дней${context.pet.isAlive ? '' : ' ⚠️ МЁРТВ'}` : 'нет'}
СЕРИЯ БЕЗ ПРОПУСКОВ: ${context.streak} дней

═══ ПРАВИЛА ДИАЛОГА ═══

1. Отвечай на русском. Коротко (2-5 предложений), если не попросили подробнее.
2. Используй имя пользователя (${name}).
3. Ты ЗНАЕШЬ весь контекст — задачи, привычки, финансы, встречи, цели. Используй их!
4. Если нужна информация — вызови tool. НЕ выдумывай данные.
5. Задавай уточняющие вопросы, если команда неоднозначная.
6. После выполнения действия кратко подтверди и предложи следующий шаг.
7. Если пользователь попрощался ("спасибо", "пока", "отбой") — попрощайся тепло и верни end_conversation: true.
8. При финансовых действиях — автоматически анализируй бюджет.
9. Учитывай время дня: утром — план, днём — статус, вечером — итоги.
10. Предлагай suggestions (кнопки) после каждого ответа — 2-4 варианта следующего действия.
11. Для критичных действий (бронирование, оплата, удаление) — ВСЕГДА спрашивай подтверждение.

═══ ФОРМАТ ОТВЕТА ═══

Всегда отвечай обычным текстом (это будет озвучено через TTS).
В поле suggestions возвращай массив строк — это будут кнопки для пользователя.
Если нужно выполнить действие — вызови соответствующий tool.
Если разговор окончен — верни end_conversation: true в финальном ответе.`;
}

// ═══════════════════════════════════════════════════
// TOOLS ДЛЯ CLAUDE (function calling)
// ═══════════════════════════════════════════════════
const CLAUDE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_task',
    description: 'Создать новую задачу. Используй когда пользователь просит добавить, создать, запланировать задачу.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Название задачи' },
        date: { type: 'string', description: 'Дата в формате YYYY-MM-DD' },
        time: { type: 'string', description: 'Время в формате HH:MM (опционально)' },
        category: { type: 'string', enum: ['work', 'personal', 'health', 'finance', 'education', 'home'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      },
      required: ['title', 'date'],
    },
  },
  {
    name: 'complete_task',
    description: 'Отметить задачу как выполненную.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'ID задачи' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'complete_habit',
    description: 'Отметить привычку как выполненную за сегодня.',
    input_schema: {
      type: 'object' as const,
      properties: {
        habitId: { type: 'string', description: 'ID привычки' },
      },
      required: ['habitId'],
    },
  },
  {
    name: 'create_event',
    description: 'Создать событие/встречу в календаре.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Название события' },
        date: { type: 'string', description: 'Дата YYYY-MM-DD' },
        startTime: { type: 'string', description: 'Начало HH:MM' },
        endTime: { type: 'string', description: 'Конец HH:MM' },
        location: { type: 'string', description: 'Место' },
        description: { type: 'string', description: 'Описание' },
      },
      required: ['title', 'date'],
    },
  },
  {
    name: 'add_expense',
    description: 'Записать расход. После записи проанализируй бюджет.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number', description: 'Сумма' },
        category: { type: 'string', enum: ['food', 'transport', 'entertainment', 'clothing', 'health', 'home', 'other'] },
        description: { type: 'string', description: 'Описание' },
      },
      required: ['amount'],
    },
  },
  {
    name: 'add_income',
    description: 'Записать доход.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number', description: 'Сумма' },
        source: { type: 'string', description: 'Источник дохода' },
      },
      required: ['amount'],
    },
  },
  {
    name: 'get_free_slots',
    description: 'Получить свободные временные окна в календаре на указанный период.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dateFrom: { type: 'string', description: 'Начало периода YYYY-MM-DD' },
        dateTo: { type: 'string', description: 'Конец периода YYYY-MM-DD' },
        minDurationMinutes: { type: 'number', description: 'Минимальная длительность окна в минутах' },
      },
      required: ['dateFrom', 'dateTo'],
    },
  },
  {
    name: 'search_contacts',
    description: 'Найти контакт по имени в телефонной книге пользователя.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Имя или часть имени контакта' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_flights',
    description: 'Найти авиабилеты. Возвращает топ-5 вариантов с ценами.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Город вылета (или IATA код)' },
        to: { type: 'string', description: 'Город прилёта (или IATA код)' },
        departDate: { type: 'string', description: 'Дата вылета YYYY-MM-DD' },
        returnDate: { type: 'string', description: 'Дата обратно YYYY-MM-DD (опционально для one-way)' },
        passengers: { type: 'number', description: 'Количество пассажиров (по умолчанию 1)' },
      },
      required: ['from', 'to', 'departDate'],
    },
  },
  {
    name: 'search_hotels',
    description: 'Найти отели в городе на заданные даты.',
    input_schema: {
      type: 'object' as const,
      properties: {
        city: { type: 'string', description: 'Город' },
        checkIn: { type: 'string', description: 'Дата заезда YYYY-MM-DD' },
        checkOut: { type: 'string', description: 'Дата выезда YYYY-MM-DD' },
        maxPrice: { type: 'number', description: 'Максимальная цена за ночь в тенге' },
      },
      required: ['city', 'checkIn', 'checkOut'],
    },
  },
  {
    name: 'build_route',
    description: 'Построить маршрут между двумя точками. Возвращает время в пути, расстояние, способы добраться.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Откуда (адрес или название)' },
        to: { type: 'string', description: 'Куда (адрес или название)' },
        mode: { type: 'string', enum: ['driving', 'transit', 'walking'], description: 'Способ передвижения' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'set_alarm',
    description: 'Поставить будильник / напоминание на определённое время.',
    input_schema: {
      type: 'object' as const,
      properties: {
        time: { type: 'string', description: 'Время HH:MM' },
        date: { type: 'string', description: 'Дата YYYY-MM-DD' },
        label: { type: 'string', description: 'Текст напоминания' },
      },
      required: ['time', 'label'],
    },
  },
  {
    name: 'send_message',
    description: 'Подготовить сообщение для отправки через WhatsApp/SMS/Telegram. Открывает мессенджер с готовым текстом — пользователь сам нажимает отправить.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contact: { type: 'string', description: 'Имя контакта или номер телефона' },
        text: { type: 'string', description: 'Текст сообщения' },
        via: { type: 'string', enum: ['whatsapp', 'sms', 'telegram'], description: 'Через что отправить' },
      },
      required: ['contact', 'text'],
    },
  },
  {
    name: 'get_weather',
    description: 'Получить прогноз погоды для города.',
    input_schema: {
      type: 'object' as const,
      properties: {
        city: { type: 'string', description: 'Город' },
        date: { type: 'string', description: 'Дата YYYY-MM-DD (по умолчанию сегодня)' },
      },
      required: ['city'],
    },
  },
  {
    name: 'convert_currency',
    description: 'Конвертировать валюту.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number', description: 'Сумма' },
        from: { type: 'string', description: 'Валюта откуда (USD, EUR, TRY, ₸ и т.д.)' },
        to: { type: 'string', description: 'Валюта куда' },
      },
      required: ['amount', 'from', 'to'],
    },
  },
  {
    name: 'get_budget_analysis',
    description: 'Получить детальный анализ бюджета: расходы по категориям, тренды, рекомендации.',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string', enum: ['week', 'month', 'year'] },
      },
      required: ['period'],
    },
  },
  {
    name: 'create_travel_plan',
    description: 'Создать полный план путешествия: билеты, отель, маршрут, бюджет, список вещей.',
    input_schema: {
      type: 'object' as const,
      properties: {
        destination: { type: 'string', description: 'Куда едем' },
        dateFrom: { type: 'string', description: 'Дата начала YYYY-MM-DD' },
        dateTo: { type: 'string', description: 'Дата окончания YYYY-MM-DD' },
        budget: { type: 'number', description: 'Бюджет в тенге (опционально)' },
        purpose: { type: 'string', description: 'Цель поездки (бизнес, отдых, встреча)' },
      },
      required: ['destination', 'dateFrom'],
    },
  },
  {
    name: 'complete_multiple_habits',
    description: 'Отметить несколько привычек сразу.',
    input_schema: {
      type: 'object' as const,
      properties: {
        habitIds: { type: 'array', items: { type: 'string' }, description: 'Массив ID привычек' },
      },
      required: ['habitIds'],
    },
  },
  {
    name: 'journal_entry',
    description: 'Записать в дневник самочувствия.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sleepHours: { type: 'number', description: 'Часы сна' },
        energy: { type: 'number', description: 'Уровень энергии 1-10' },
        mood: { type: 'number', description: 'Настроение 1-10' },
        notes: { type: 'string', description: 'Заметки' },
      },
      required: [],
    },
  },
  {
    name: 'goodnight_summary',
    description: 'Подвести итоги дня (ночной ритуал). Вызывай когда пользователь ложится спать.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ═══════════════════════════════════════════════════
// ОБРАБОТКА СООБЩЕНИЯ — ГЛАВНЫЙ ЦИКЛ
// ═══════════════════════════════════════════════════
export async function processConversationMessage(params: {
  sessionId: string;
  userId: string;
  userText: string;
  isEndRequested: boolean;
}): Promise<{
  userMsgId: string;
  assistantMsgId: string;
  response: string;
  actions: any[];
  suggestions: string[];
  endConversation: boolean;
}> {
  const { sessionId, userId, userText, isEndRequested } = params;

  // 1. Получаем сессию и историю
  const session = await prisma.conversationSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  const history = await prisma.conversationMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: 50, // Лимит истории (экономим токены)
  });

  // 2. Сохраняем сообщение пользователя
  const userMsg = await prisma.conversationMessage.create({
    data: { sessionId, role: 'user', content: userText },
  });

  // 3. Собираем свежий контекст (мог измениться после предыдущих действий)
  const context = await buildInitialContext(userId);

  // 4. Формируем messages для Claude
  const messages: Anthropic.MessageParam[] = [];

  for (const msg of history) {
    messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
  }
  messages.push({ role: 'user', content: userText });

  // Если пользователь прощается — добавляем подсказку
  if (isEndRequested) {
    messages[messages.length - 1] = {
      role: 'user',
      content: `${userText}\n\n[Пользователь прощается. Подведи краткий итог того, что сделал в этом диалоге, попрощайся тепло. Верни end_conversation: true.]`,
    };
  }

  // 5. Вызываем Claude с tool_use
  const actions: any[] = [];
  let finalResponse = '';
  let endConversation = false;

  // Tool use loop — Claude может вызвать несколько tools подряд
  let currentMessages = [...messages];
  let iterationCount = 0;
  const MAX_ITERATIONS = 10; // Защита от бесконечного цикла

  while (iterationCount < MAX_ITERATIONS) {
    iterationCount++;

    const claudeResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: buildSystemPrompt(context),
      tools: CLAUDE_TOOLS,
      messages: currentMessages,
    });

    // Обрабатываем ответ
    const textBlocks = claudeResponse.content.filter(b => b.type === 'text');
    const toolBlocks = claudeResponse.content.filter(b => b.type === 'tool_use');

    if (toolBlocks.length > 0) {
      // Claude хочет вызвать tools
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolBlock of toolBlocks) {
        if (toolBlock.type !== 'tool_use') continue;
        const result = await executeAction(toolBlock.name, toolBlock.input as Record<string, any>, userId);
        actions.push({ type: toolBlock.name, success: result.success, data: result.data, message: result.message });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result),
        });
      }

      // Добавляем ответ Claude и результаты tools в историю и продолжаем цикл
      currentMessages.push({ role: 'assistant', content: claudeResponse.content as any });
      currentMessages.push({ role: 'user', content: toolResults });

    } else {
      // Claude дал финальный текстовый ответ
      finalResponse = textBlocks.map(b => b.type === 'text' ? b.text : '').join('\n');
      break;
    }

    if (claudeResponse.stop_reason === 'end_turn') {
      finalResponse = textBlocks.map(b => b.type === 'text' ? b.text : '').join('\n');
      break;
    }
  }

  // 6. Проверяем end_conversation в ответе
  if (isEndRequested || finalResponse.includes('end_conversation: true')) {
    endConversation = true;
    finalResponse = finalResponse.replace('end_conversation: true', '').trim();
  }

  // 7. Генерируем suggestions на основе контекста
  const suggestions = endConversation ? [] : generateSuggestions(context, actions);

  // 8. Сохраняем ответ ассистента
  const assistantMsg = await prisma.conversationMessage.create({
    data: {
      sessionId,
      role: 'assistant',
      content: finalResponse,
      actions: actions.length > 0 ? actions : undefined,
    },
  });

  return {
    userMsgId: userMsg.id,
    assistantMsgId: assistantMsg.id,
    response: finalResponse,
    actions,
    suggestions,
    endConversation,
  };
}

// ─── Генерация кнопок-подсказок ──────────────────
function generateSuggestions(context: any, recentActions: any[]): string[] {
  const suggestions: string[] = [];
  const hour = parseInt(context.today.time.split(':')[0], 10);

  // Контекстные подсказки
  if (context.tasks.completed < context.tasks.total) {
    const nextTask = context.tasks.items.find((t: any) => !t.completed);
    if (nextTask) suggestions.push(`Закрыть "${nextTask.title}"`);
  }

  if (context.habits.completed < context.habits.total) {
    suggestions.push('Отметить привычки');
  }

  if (context.events.today.length > 0) {
    suggestions.push('Расскажи про встречи');
  }

  if (!context.journal) {
    suggestions.push('Заполнить дневник');
  }

  suggestions.push('Как с бюджетом?');

  if (hour >= 21) {
    suggestions.push('Спокойной ночи');
  }

  // Максимум 4 кнопки
  return suggestions.slice(0, 4);
}
```

### 2.3 Action Executor — выполнение действий

```typescript
// packages/server/src/services/action-executor.ts

import { prisma } from '../prisma';

type ActionResult = {
  success: boolean;
  data?: any;
  message: string;
};

export async function executeAction(
  actionName: string,
  input: Record<string, any>,
  userId: string,
): Promise<ActionResult> {
  
  try {
    switch (actionName) {

      // ═══════════════════════════════════════════
      // ЗАДАЧИ
      // ═══════════════════════════════════════════
      case 'create_task': {
        const task = await prisma.task.create({
          data: {
            userId,
            title: input.title,
            date: new Date(input.date),
            time: input.time ?? null,
            category: input.category ?? 'personal',
            priority: input.priority ?? 'medium',
          },
        });
        return { success: true, data: task, message: `Задача "${input.title}" создана на ${input.date}${input.time ? ' в ' + input.time : ''}` };
      }

      case 'complete_task': {
        const task = await prisma.task.update({
          where: { id: input.taskId, userId },
          data: { completed: true },
        });
        return { success: true, data: task, message: `Задача "${task.title}" выполнена ✅` };
      }

      // ═══════════════════════════════════════════
      // ПРИВЫЧКИ
      // ═══════════════════════════════════════════
      case 'complete_habit': {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const log = await prisma.habitLog.upsert({
          where: { habitId_date: { habitId: input.habitId, date: today } },
          update: { completed: true },
          create: { habitId: input.habitId, userId, date: today, completed: true },
        });
        const habit = await prisma.habit.findUnique({ where: { id: input.habitId } });
        return { success: true, data: log, message: `Привычка "${habit?.name}" отмечена ✅` };
      }

      case 'complete_multiple_habits': {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const results = [];
        for (const habitId of input.habitIds) {
          const log = await prisma.habitLog.upsert({
            where: { habitId_date: { habitId, date: today } },
            update: { completed: true },
            create: { habitId, userId, date: today, completed: true },
          });
          results.push(log);
        }
        return { success: true, data: results, message: `Отмечено привычек: ${results.length} ✅` };
      }

      // ═══════════════════════════════════════════
      // СОБЫТИЯ / КАЛЕНДАРЬ
      // ═══════════════════════════════════════════
      case 'create_event': {
        const event = await prisma.calendarEvent.create({
          data: {
            userId,
            title: input.title,
            date: new Date(input.date),
            startTime: input.startTime ?? null,
            endTime: input.endTime ?? null,
            location: input.location ?? null,
            description: input.description ?? null,
            source: 'voice',
          },
        });
        return { success: true, data: event, message: `Встреча "${input.title}" создана на ${input.date}${input.startTime ? ' в ' + input.startTime : ''}` };
      }

      case 'get_free_slots': {
        const dateFrom = new Date(input.dateFrom);
        const dateTo = new Date(input.dateTo);
        const minDuration = input.minDurationMinutes ?? 60;

        const events = await prisma.calendarEvent.findMany({
          where: { userId, date: { gte: dateFrom, lte: dateTo } },
          orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        });

        // Алгоритм поиска свободных окон
        const slots = findFreeSlots(events, dateFrom, dateTo, minDuration);
        return { success: true, data: slots, message: `Найдено ${slots.length} свободных окон` };
      }

      // ═══════════════════════════════════════════
      // ФИНАНСЫ
      // ═══════════════════════════════════════════
      case 'add_expense': {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expense = await prisma.expense.create({
          data: {
            userId,
            date: today,
            amount: input.amount,
            category: input.category ?? 'other',
            description: input.description ?? '',
          },
        });

        // Автоматический анализ бюджета
        const analysis = await analyzeBudgetAfterExpense(userId, input.category ?? 'other');
        return {
          success: true,
          data: { expense, analysis },
          message: `Расход ${input.amount} ₸ записан${input.description ? ' (' + input.description + ')' : ''}. ${analysis.warning || ''}`,
        };
      }

      case 'add_income': {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const income = await prisma.income.create({
          data: { userId, date: today, amount: input.amount, source: input.source ?? '' },
        });
        return { success: true, data: income, message: `Доход ${input.amount} ₸ записан${input.source ? ' (' + input.source + ')' : ''}` };
      }

      case 'get_budget_analysis': {
        const analysis = await getFullBudgetAnalysis(userId, input.period);
        return { success: true, data: analysis, message: 'Анализ бюджета готов' };
      }

      // ═══════════════════════════════════════════
      // ПОИСК КОНТАКТОВ (данные от клиента через контекст)
      // ═══════════════════════════════════════════
      case 'search_contacts': {
        // На сервере храним кэш контактов пользователя (синхронизируются с телефона)
        // В реальности это будет вызов к клиенту или к кэшу
        return { 
          success: true, 
          data: { note: 'Contact search requires client-side expo-contacts lookup. Returning to client for resolution.' },
          message: `Ищу контакт "${input.query}" в телефонной книге...`,
        };
      }

      // ═══════════════════════════════════════════
      // ПУТЕШЕСТВИЯ
      // ═══════════════════════════════════════════
      case 'search_flights': {
        const flights = await searchFlightsAPI(input);
        return { success: true, data: flights, message: `Найдено ${flights.length} вариантов перелёта` };
      }

      case 'search_hotels': {
        const hotels = await searchHotelsAPI(input);
        return { success: true, data: hotels, message: `Найдено ${hotels.length} отелей` };
      }

      case 'build_route': {
        const route = await buildRouteAPI(input);
        return { success: true, data: route, message: `Маршрут: ${route.distance}, время в пути ${route.duration}` };
      }

      case 'create_travel_plan': {
        // Комплексное действие — создаёт множество объектов
        const plan = await createFullTravelPlan(userId, input);
        return { success: true, data: plan, message: `План путешествия в ${input.destination} создан: ${plan.summary}` };
      }

      // ═══════════════════════════════════════════
      // УТИЛИТЫ
      // ═══════════════════════════════════════════
      case 'set_alarm': {
        // Отправляем push-уведомление через scheduled notification
        return {
          success: true,
          data: { time: input.time, date: input.date, label: input.label },
          message: `Напоминание "${input.label}" установлено на ${input.time}`,
        };
      }

      case 'send_message': {
        // Возвращаем данные для открытия мессенджера на клиенте
        return {
          success: true,
          data: { contact: input.contact, text: input.text, via: input.via ?? 'whatsapp', action: 'open_messenger' },
          message: `Открываю ${input.via || 'WhatsApp'} с сообщением для ${input.contact}`,
        };
      }

      case 'get_weather': {
        const weather = await getWeatherAPI(input.city, input.date);
        return { success: true, data: weather, message: `Погода в ${input.city}: ${weather.temp}°C, ${weather.description}` };
      }

      case 'convert_currency': {
        const result = await convertCurrencyAPI(input.amount, input.from, input.to);
        return { success: true, data: result, message: `${input.amount} ${input.from} = ${result.converted} ${input.to}` };
      }

      case 'journal_entry': {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const entry = await prisma.journalEntry.upsert({
          where: { userId_date: { userId, date: today } },
          update: { sleepHours: input.sleepHours, energy: input.energy, mood: input.mood, notes: input.notes },
          create: { userId, date: today, sleepHours: input.sleepHours, energy: input.energy, mood: input.mood, notes: input.notes },
        });
        return { success: true, data: entry, message: 'Дневник обновлён' };
      }

      case 'goodnight_summary': {
        const summary = await buildGoodnightSummary(userId);
        return { success: true, data: summary, message: summary.text };
      }

      default:
        return { success: false, message: `Неизвестное действие: ${actionName}` };
    }
  } catch (err: any) {
    return { success: false, message: `Ошибка: ${err.message}` };
  }
}

// ═══════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════

function findFreeSlots(
  events: Array<{ date: Date; startTime: string | null; endTime: string | null }>,
  dateFrom: Date,
  dateTo: Date,
  minDurationMinutes: number,
): Array<{ date: string; from: string; to: string; durationMinutes: number }> {
  const slots: Array<{ date: string; from: string; to: string; durationMinutes: number }> = [];
  const WORK_START = '09:00';
  const WORK_END = '20:00';

  for (let d = new Date(dateFrom); d <= dateTo; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayEvents = events
      .filter(e => e.date.toISOString().split('T')[0] === dateStr && e.startTime && e.endTime)
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    let currentStart = WORK_START;
    for (const event of dayEvents) {
      if (event.startTime && event.startTime > currentStart) {
        const duration = timeDiffMinutes(currentStart, event.startTime);
        if (duration >= minDurationMinutes) {
          slots.push({ date: dateStr, from: currentStart, to: event.startTime, durationMinutes: duration });
        }
      }
      if (event.endTime && event.endTime > currentStart) {
        currentStart = event.endTime;
      }
    }
    // Окно после последнего события
    if (currentStart < WORK_END) {
      const duration = timeDiffMinutes(currentStart, WORK_END);
      if (duration >= minDurationMinutes) {
        slots.push({ date: dateStr, from: currentStart, to: WORK_END, durationMinutes: duration });
      }
    }
  }

  return slots;
}

function timeDiffMinutes(from: string, to: string): number {
  const [h1, m1] = from.split(':').map(Number);
  const [h2, m2] = to.split(':').map(Number);
  return (h2 * 60 + m2) - (h1 * 60 + m1);
}

async function analyzeBudgetAfterExpense(userId: string, category: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [expenses, limit] = await Promise.all([
    prisma.expense.aggregate({
      where: { userId, category, date: { gte: monthStart, lte: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.budgetLimit.findUnique({
      where: { userId_category_month_year: { userId, category, month: now.getMonth() + 1, year: now.getFullYear() } },
    }),
  ]);

  const spent = expenses._sum.amount ?? 0;
  const budgetLimit = limit?.monthlyLimit ?? 0;
  const percentage = budgetLimit > 0 ? (spent / budgetLimit) * 100 : 0;
  const daysLeft = monthEnd.getDate() - now.getDate();

  let warning = '';
  if (budgetLimit > 0) {
    if (percentage > 100) warning = `⚠️ Бюджет на ${category} превышен на ${Math.round(percentage - 100)}%!`;
    else if (percentage > 80) warning = `⚡ Осторожно: ${Math.round(percentage)}% бюджета на ${category} использовано.`;
  }

  return { spent, budgetLimit, percentage, daysLeft, warning, dailyRemaining: daysLeft > 0 ? Math.round((budgetLimit - spent) / daysLeft) : 0 };
}

async function getFullBudgetAnalysis(userId: string, period: string) {
  // ... детальный анализ по периоду
  return { summary: 'Анализ бюджета' };
}

async function buildGoodnightSummary(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [tasks, habits, habitLogs, expenses] = await Promise.all([
    prisma.task.findMany({ where: { userId, date: today } }),
    prisma.habit.findMany({ where: { userId, active: true } }),
    prisma.habitLog.findMany({ where: { userId, date: today, completed: true } }),
    prisma.expense.aggregate({ where: { userId, date: today }, _sum: { amount: true } }),
  ]);

  const tasksCompleted = tasks.filter(t => t.completed).length;
  const habitsCompleted = habitLogs.length;
  const totalProgress = Math.round(
    ((tasksCompleted / Math.max(tasks.length, 1)) * 50 +
     (habitsCompleted / Math.max(habits.length, 1)) * 50)
  );
  const todaySpent = expenses._sum.amount ?? 0;

  return {
    tasksCompleted,
    tasksTotal: tasks.length,
    habitsCompleted,
    habitsTotal: habits.length,
    totalProgress,
    todaySpent,
    text: `Итоги дня: задачи ${tasksCompleted}/${tasks.length}, привычки ${habitsCompleted}/${habits.length}, прогресс ${totalProgress}%. Потрачено: ${todaySpent} ₸.`,
  };
}

// ═══════════════════════════════════════════════════
// ВНЕШНИЕ API (заглушки — реализация ниже)
// ═══════════════════════════════════════════════════

async function searchFlightsAPI(params: any): Promise<any[]> {
  // Aviasales API / Kiwi.com API
  // GET https://api.travelpayouts.com/aviasales/v3/prices_for_dates
  //   ?origin=${params.from}&destination=${params.to}&departure_at=${params.departDate}
  //   &token=${process.env.AVIASALES_API_TOKEN}
  // Пока заглушка:
  return [
    { airline: 'Air Astana', price: 85000, currency: 'KZT', departure: '06:00', arrival: '10:30', duration: '4ч 30м', stops: 0 },
    { airline: 'FlyArystan', price: 52000, currency: 'KZT', departure: '14:00', arrival: '19:00', duration: '5ч 00м', stops: 1 },
  ];
}

async function searchHotelsAPI(params: any): Promise<any[]> {
  // Booking.com Affiliate API
  return [
    { name: 'Istanbul Grand Hotel', price: 25000, currency: 'KZT', rating: 4.5, distance: '1.2 км от центра' },
    { name: 'Bosphorus View', price: 45000, currency: 'KZT', rating: 4.8, distance: '0.5 км от центра' },
  ];
}

async function buildRouteAPI(params: any): Promise<any> {
  // Google Maps Directions API
  // GET https://maps.googleapis.com/maps/api/directions/json
  //   ?origin=${params.from}&destination=${params.to}&mode=${params.mode || 'driving'}
  //   &key=${process.env.GOOGLE_MAPS_API_KEY}
  return {
    distance: '12 км',
    duration: '25 мин',
    steps: ['Выехать на проспект Мангилик Ел', 'Повернуть на Кабанбай батыра', 'Прибытие'],
  };
}

async function createFullTravelPlan(userId: string, params: any) {
  // Комплексная функция: создаёт события, задачи, считает бюджет
  const tasks = [
    { title: `Купить билеты в ${params.destination}`, category: 'personal', priority: 'high' },
    { title: 'Забронировать отель', category: 'personal', priority: 'high' },
    { title: 'Собрать чемодан', category: 'personal', priority: 'medium' },
    { title: 'Проверить документы (паспорт, виза)', category: 'personal', priority: 'critical' },
  ];

  const dateFrom = new Date(params.dateFrom);
  for (const t of tasks) {
    const taskDate = new Date(dateFrom);
    taskDate.setDate(taskDate.getDate() - 3); // За 3 дня до поездки
    await prisma.task.create({
      data: { userId, title: t.title, date: taskDate, category: t.category, priority: t.priority },
    });
  }

  // Создаём событие поездки
  await prisma.calendarEvent.create({
    data: {
      userId,
      title: `Поездка в ${params.destination}`,
      date: dateFrom,
      description: params.purpose ?? 'Путешествие',
      source: 'voice',
    },
  });

  return {
    summary: `Создано ${tasks.length} задач, событие в календаре. Поиск билетов и отелей готов к запуску.`,
    tasksCreated: tasks.length,
    eventCreated: true,
  };
}

async function getWeatherAPI(city: string, date?: string): Promise<any> {
  // OpenWeatherMap API
  // GET https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric&lang=ru
  return { temp: 22, description: 'Облачно', humidity: 65, wind: 12 };
}

async function convertCurrencyAPI(amount: number, from: string, to: string): Promise<any> {
  // Exchange Rates API
  // GET https://api.exchangerate-api.com/v4/latest/${from}
  const rates: Record<string, number> = { USD: 1, KZT: 470, EUR: 0.92, TRY: 32, RUB: 96 };
  const fromNorm = from === '₸' ? 'KZT' : from.toUpperCase();
  const toNorm = to === '₸' ? 'KZT' : to.toUpperCase();
  const inUSD = amount / (rates[fromNorm] || 1);
  const converted = Math.round(inUSD * (rates[toNorm] || 1));
  return { original: amount, from: fromNorm, to: toNorm, converted, rate: (rates[toNorm] || 1) / (rates[fromNorm] || 1) };
}
```

---

## ЧАСТЬ 3: PRISMA SCHEMA — НОВЫЕ МОДЕЛИ

```prisma
// Добавить в packages/server/prisma/schema.prisma

model ConversationSession {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  contextSnapshot Json     // снапшот контекста при старте сессии
  status          String   @default("active") // "active", "ended"
  endedAt         DateTime?
  createdAt       DateTime @default(now())
  messages        ConversationMessage[]
  @@index([userId])
}

model ConversationMessage {
  id        String   @id @default(cuid())
  sessionId String
  session   ConversationSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  role      String   // "user", "assistant"
  content   String
  actions   Json?    // выполненные действия [{ type, success, message }]
  createdAt DateTime @default(now())
  @@index([sessionId])
}

model TravelPlan {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  destination   String
  dateFrom      DateTime @db.Date
  dateTo        DateTime? @db.Date
  purpose       String?  // "business", "vacation", "meeting"
  budget        Float?
  currency      String   @default("₸")
  status        String   @default("planning") // "planning", "booked", "in_progress", "completed"
  flights       Json?    // найденные/забронированные рейсы
  hotels        Json?    // найденные/забронированные отели
  routes        Json?    // маршруты
  packingList   Json?    // список вещей
  documents     Json?    // { passport: true, visa: true, insurance: true }
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([userId])
}

model ContactCache {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  phoneId     String   // ID контакта в телефоне
  name        String
  phone       String?
  email       String?
  birthday    DateTime? @db.Date
  lastSynced  DateTime @default(now())
  @@unique([userId, phoneId])
  @@index([userId, name])
}

model DocumentVault {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  type        String   // "passport", "id_card", "driver_license", "insurance", "visa"
  title       String
  data        Json     // зашифрованные данные (номер, дата выдачи, срок действия)
  imageUri    String?  // URI скана (зашифрованный)
  expiresAt   DateTime?
  createdAt   DateTime @default(now())
  @@index([userId])
}

// Добавить связи в модель User:
// conversationSessions ConversationSession[]
// travelPlans          TravelPlan[]
// contactCache         ContactCache[]
// documentVault        DocumentVault[]
```

---

## ЧАСТЬ 4: DEEP PHONE INTEGRATION (Клиент)

### 4.1 Синхронизация контактов

```typescript
// apps/mobile/services/contacts-sync.ts

import * as Contacts from 'expo-contacts';
import { api } from './api';

export async function syncContacts(): Promise<void> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') return;

  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.Name,
      Contacts.Fields.PhoneNumbers,
      Contacts.Fields.Emails,
      Contacts.Fields.Birthday,
    ],
  });

  if (data.length === 0) return;

  // Отправляем на сервер для кэширования (AI сможет искать по имени)
  const contacts = data.map(c => ({
    phoneId: c.id!,
    name: c.name ?? '',
    phone: c.phoneNumbers?.[0]?.number ?? null,
    email: c.emails?.[0]?.email ?? null,
    birthday: c.birthday ? `${c.birthday.year}-${String(c.birthday.month! + 1).padStart(2, '0')}-${String(c.birthday.day!).padStart(2, '0')}` : null,
  })).filter(c => c.name);

  await api.post('/contacts/sync', { contacts });
}
```

### 4.2 Синхронизация календаря

```typescript
// apps/mobile/services/calendar-sync.ts

import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { api } from './api';

export async function syncCalendar(): Promise<void> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return;

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const defaultCalendar = calendars.find(c => c.isPrimary) || calendars[0];
  if (!defaultCalendar) return;

  // Получаем события на 30 дней вперёд
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 30);

  const events = await Calendar.getEventsAsync([defaultCalendar.id], start, end);

  const formatted = events.map(e => ({
    externalId: e.id,
    title: e.title,
    date: e.startDate,
    startTime: new Date(e.startDate).toTimeString().slice(0, 5),
    endTime: e.endDate ? new Date(e.endDate).toTimeString().slice(0, 5) : null,
    location: e.location ?? null,
    description: e.notes ?? null,
  }));

  await api.post('/calendar/sync', { events: formatted });
}

// Создать событие в системном календаре (двусторонняя синхронизация)
export async function createSystemCalendarEvent(params: {
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  notes?: string;
}): Promise<string | null> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return null;

  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = calendars.find(c => c.allowsModifications) || calendars[0];
  if (!writable) return null;

  const eventId = await Calendar.createEventAsync(writable.id, {
    title: params.title,
    startDate: params.startDate,
    endDate: params.endDate,
    location: params.location,
    notes: params.notes,
    timeZone: 'Asia/Almaty',
  });

  return eventId;
}
```

### 4.3 Deep Linking (открытие мессенджеров, карт, приложений)

```typescript
// apps/mobile/services/deep-links.ts

import { Linking, Platform } from 'react-native';

// WhatsApp
export async function openWhatsApp(phone: string, text: string): Promise<void> {
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  const url = `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;
  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
  } else {
    // Fallback: web WhatsApp
    await Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`);
  }
}

// Telegram
export async function openTelegram(username: string, text?: string): Promise<void> {
  const url = text
    ? `tg://msg?to=${username}&text=${encodeURIComponent(text)}`
    : `tg://resolve?domain=${username}`;
  await Linking.openURL(url);
}

// SMS
export async function openSMS(phone: string, text: string): Promise<void> {
  const separator = Platform.OS === 'ios' ? '&' : '?';
  await Linking.openURL(`sms:${phone}${separator}body=${encodeURIComponent(text)}`);
}

// Телефонный звонок
export async function makeCall(phone: string): Promise<void> {
  await Linking.openURL(`tel:${phone}`);
}

// Google Maps / Apple Maps (маршрут)
export async function openMapsRoute(destination: string, mode: 'driving' | 'transit' | 'walking' = 'driving'): Promise<void> {
  const encoded = encodeURIComponent(destination);
  if (Platform.OS === 'ios') {
    await Linking.openURL(`maps://app?daddr=${encoded}&dirflg=${mode === 'driving' ? 'd' : mode === 'transit' ? 'r' : 'w'}`);
  } else {
    await Linking.openURL(`google.navigation:q=${encoded}&mode=${mode[0]}`);
  }
}

// 2GIS (Казахстан)
export async function open2GIS(query: string): Promise<void> {
  const url = `dgis://2gis.ru/search/${encodeURIComponent(query)}`;
  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
  } else {
    await Linking.openURL(`https://2gis.kz/astana/search/${encodeURIComponent(query)}`);
  }
}

// Uber / Яндекс Такси
export async function openTaxi(destination: string): Promise<void> {
  // Сначала пробуем Яндекс Go (популярнее в Казахстане)
  const yandexUrl = `yandextaxi://route?end-lat=0&end-lon=0&appmetrica_tracking_id=1`;
  const canOpenYandex = await Linking.canOpenURL(yandexUrl);
  if (canOpenYandex) {
    await Linking.openURL(yandexUrl);
  } else {
    // Fallback: Uber
    await Linking.openURL(`uber://?action=setPickup&dropoff[formatted_address]=${encodeURIComponent(destination)}`);
  }
}

// Открыть URL (для бронирования)
export async function openURL(url: string): Promise<void> {
  await Linking.openURL(url);
}
```

### 4.4 Умный будильник

```typescript
// apps/mobile/services/smart-alarm.ts

import * as Notifications from 'expo-notifications';

export async function setSmartAlarm(params: {
  time: string;     // "HH:MM"
  date: string;     // "YYYY-MM-DD"
  label: string;
  travelTime?: number;  // минут на дорогу (если нужно приехать к определённому времени)
}): Promise<string> {
  const [hours, minutes] = params.time.split(':').map(Number);
  const trigger = new Date(params.date);
  trigger.setHours(hours, minutes, 0, 0);

  // Если есть время на дорогу — будим раньше
  if (params.travelTime) {
    trigger.setMinutes(trigger.getMinutes() - params.travelTime - 30); // + 30 мин на сборы
  }

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: '⏰ ' + params.label,
      body: params.travelTime
        ? `Вставай! На дорогу нужно ${params.travelTime} мин + 30 мин на сборы.`
        : `Время: ${params.time}`,
      sound: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: { date: trigger },
  });

  return id;
}
```

---

## ЧАСТЬ 5: ВНЕШНИЕ API — КОНФИГУРАЦИЯ

### 5.1 Необходимые API ключи (.env)

```env
# Существующие
CLAUDE_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...
DATABASE_URL=postgresql://...
JWT_SECRET=...

# Новые для J.A.R.V.I.S.
AVIASALES_API_TOKEN=...          # https://www.travelpayouts.com/developers/api
GOOGLE_MAPS_API_KEY=...          # https://console.cloud.google.com (Directions API)
OPENWEATHER_API_KEY=...          # https://openweathermap.org/api
EXCHANGE_RATES_API_KEY=...       # https://exchangerate-api.com (бесплатный план)
BOOKING_AFFILIATE_ID=...         # https://www.booking.com/affiliate (опционально)
```

### 5.2 Реальные API-вызовы (замена заглушек)

```typescript
// packages/server/src/services/external-apis.ts

// ═══════════════════════════════════════════
// АВИАБИЛЕТЫ (Aviasales / Travelpayouts)
// ═══════════════════════════════════════════
export async function searchFlightsReal(params: {
  from: string; to: string; departDate: string; returnDate?: string;
}): Promise<any[]> {
  const token = process.env.AVIASALES_API_TOKEN;
  // Маппинг городов → IATA
  const cityToIATA: Record<string, string> = {
    'астана': 'NQZ', 'алматы': 'ALA', 'стамбул': 'IST',
    'москва': 'MOW', 'дубай': 'DXB', 'бангкок': 'BKK',
    'анталья': 'AYT', 'батуми': 'BUS', 'тбилиси': 'TBS',
  };
  const origin = cityToIATA[params.from.toLowerCase()] || params.from;
  const destination = cityToIATA[params.to.toLowerCase()] || params.to;

  const url = `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${origin}&destination=${destination}&departure_at=${params.departDate}${params.returnDate ? '&return_at=' + params.returnDate : ''}&sorting=price&token=${token}`;

  const response = await fetch(url);
  const data = await response.json();

  return (data.data || []).slice(0, 5).map((f: any) => ({
    airline: f.airline,
    price: f.price,
    currency: 'KZT',
    departure: f.departure_at,
    arrival: f.arrival_at,
    duration: `${Math.floor(f.duration / 60)}ч ${f.duration % 60}м`,
    stops: f.transfers,
    link: `https://www.aviasales.ru${f.link}`,
  }));
}

// ═══════════════════════════════════════════
// МАРШРУТЫ (Google Maps Directions)
// ═══════════════════════════════════════════
export async function buildRouteReal(params: {
  from: string; to: string; mode?: string;
}): Promise<any> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const mode = params.mode || 'driving';
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(params.from)}&destination=${encodeURIComponent(params.to)}&mode=${mode}&language=ru&key=${key}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.routes.length === 0) {
    return { distance: 'неизвестно', duration: 'неизвестно', steps: [] };
  }

  const route = data.routes[0].legs[0];
  return {
    distance: route.distance.text,
    duration: route.duration.text,
    durationMinutes: Math.round(route.duration.value / 60),
    steps: route.steps.map((s: any) => s.html_instructions.replace(/<[^>]*>/g, '')),
    startAddress: route.start_address,
    endAddress: route.end_address,
  };
}

// ═══════════════════════════════════════════
// ПОГОДА (OpenWeatherMap)
// ═══════════════════════════════════════════
export async function getWeatherReal(city: string): Promise<any> {
  const key = process.env.OPENWEATHER_API_KEY;
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${key}&units=metric&lang=ru`;

  const response = await fetch(url);
  const data = await response.json();

  return {
    temp: Math.round(data.main.temp),
    feelsLike: Math.round(data.main.feels_like),
    description: data.weather[0].description,
    humidity: data.main.humidity,
    wind: Math.round(data.wind.speed),
    icon: data.weather[0].icon,
  };
}

// ═══════════════════════════════════════════
// ВАЛЮТЫ (Exchange Rate API)
// ═══════════════════════════════════════════
export async function convertCurrencyReal(
  amount: number, from: string, to: string,
): Promise<{ converted: number; rate: number }> {
  const fromCode = from === '₸' ? 'KZT' : from.toUpperCase();
  const toCode = to === '₸' ? 'KZT' : to.toUpperCase();
  
  const url = `https://api.exchangerate-api.com/v4/latest/${fromCode}`;
  const response = await fetch(url);
  const data = await response.json();
  const rate = data.rates[toCode] ?? 1;

  return {
    converted: Math.round(amount * rate * 100) / 100,
    rate: Math.round(rate * 10000) / 10000,
  };
}
```

---

## ЧАСТЬ 6: НОВЫЕ API ENDPOINTS (сводка)

```
# Голосовой диалог
POST   /voice/conversation/start     # начать сессию диалога
POST   /voice/conversation/message   # голосовое сообщение (multipart: audio + sessionId)
POST   /voice/conversation/text      # текстовое сообщение
POST   /voice/conversation/end       # завершить сессию

# Синхронизация с телефоном
POST   /contacts/sync                # синхронизация контактов
GET    /contacts/search?q=           # поиск контакта по имени
POST   /calendar/sync                # синхронизация событий системного календаря
GET    /calendar/free-slots          # свободные окна в расписании

# Путешествия
POST   /travel/search-flights        # поиск авиабилетов
POST   /travel/search-hotels         # поиск отелей
POST   /travel/build-route           # построить маршрут
POST   /travel/create-plan           # создать полный план поездки
GET    /travel/plans                  # список планов поездок
GET    /travel/plans/:id             # детали плана

# Утилиты
GET    /weather?city=                # погода
GET    /currency/convert?amount=&from=&to=  # конвертация валют

# Документы (Document Vault)
POST   /documents                    # сохранить документ (паспорт, права, и т.д.)
GET    /documents                    # список документов
GET    /documents/:id                # детали документа
DELETE /documents/:id                # удалить
GET    /documents/expiring           # документы с истекающим сроком
```

---

## ЧАСТЬ 7: ФАЗЫ РЕАЛИЗАЦИИ

### Фаза 1 (1–2 недели): Базовый голосовой диалог
- Voice State Machine на клиенте (useVoiceConversation hook)
- VoiceConversationScreen UI
- POST /voice/conversation/* endpoints на сервере
- ConversationSession + ConversationMessage в Prisma
- Claude API с tool_use для create_task, complete_task, complete_habit, create_event, add_expense
- Suggestions (кнопки-подсказки) после каждого ответа
- Завершение по "Спасибо LifeOS"

### Фаза 2 (2–3 недели): Умные действия
- get_free_slots — поиск свободных окон в календаре
- Полный tool calling: все 20 tools из спецификации
- Анализ бюджета после каждого расхода
- Ночной ритуал (goodnight_summary)
- Утренний сценарий с контекстом дня

### Фаза 3 (2–3 недели): Интеграция с телефоном
- expo-contacts: синхронизация контактов + ContactCache
- expo-calendar: двухсторонняя синхронизация
- Deep links: WhatsApp, Telegram, SMS, звонки
- Deep links: Google Maps / 2GIS / Uber / Яндекс Такси
- Smart Alarm через expo-notifications

### Фаза 4 (2–3 недели): Путешествия + Внешние API
- Aviasales API: поиск авиабилетов
- Google Maps Directions API: маршруты + время в пути
- OpenWeatherMap: погода
- Exchange Rates API: конвертация валют
- TravelPlan модель + create_travel_plan (комплексное действие)
- Document Vault: хранение паспорта, визы, страховки

### Фаза 5 (1–2 недели): VAD + Wake Word
- Voice Activity Detection (определение тишины без кнопки)
- Siri Shortcuts интеграция (iOS): "Привет LifeOS" → открытие приложения
- Оптимизация латентности: Groq Whisper streaming, Claude streaming
- Кэширование контекста (не пересобирать при каждом сообщении)

---

## ЧАСТЬ 8: ПОЛНЫЙ ПРИМЕР ДИАЛОГА (от начала до конца)

```
[Пользователь открывает приложение утром, 08:15]

LIFEOS (TTS): "Доброе утро, Берик! Сегодня у тебя 5 задач и 4 привычки. 
              Ближайшая встреча в 14:00 с поставщиком. Чем могу помочь?"

[Кнопки]: "📋 Планы", "📅 Встречи", "💰 Бюджет", "🎤 Спросить"

БЕРИК: "Какие встречи на этой неделе?"

LIFEOS → Claude API:
  tools call: get_free_slots({ dateFrom: "2026-04-13", dateTo: "2026-04-17" })
  → получает свободные слоты

LIFEOS (TTS): "На этой неделе 3 встречи: сегодня в 14:00 с поставщиком, 
              завтра в 11:00 с Канатом, и в пятницу в 16:00 с бухгалтером. 
              У тебя свободно завтра с 13 до 17 и в среду весь день."

[Кнопки]: "Запиши встречу", "Подробнее про завтра", "Открыть календарь"

БЕРИК: "Запиши на свободное время Серика"

LIFEOS → Claude API:
  tools call: search_contacts({ query: "Серик" })
  → находит: Серик Аскаров, +7 701 123 4567

LIFEOS (TTS): "Нашёл Серика Аскарова. Когда удобнее — завтра с 13 до 17 или в среду?"

БЕРИК: "В среду утром"

LIFEOS → Claude API:
  tools call: create_event({ title: "Встреча с Серик Аскаров", date: "2026-04-15", startTime: "10:00", endTime: "11:00" })

LIFEOS (TTS): "Записал: встреча с Сериком, среда 15 апреля в 10:00. 
              Написать ему в WhatsApp для подтверждения?"

[Кнопки]: "Да, напиши", "Нет, не надо", "Перенести на другое время"

БЕРИК: "Да, напиши"

LIFEOS → Claude API:
  tools call: send_message({ contact: "+77011234567", text: "Привет, Серик! Давай встретимся в среду в 10:00? Удобно?", via: "whatsapp" })
  → клиент открывает WhatsApp

LIFEOS (TTS): "Открыл WhatsApp с сообщением для Серика. Проверь и отправь. 
              Что-нибудь ещё?"

[Кнопки]: "Мне нужно в Стамбул", "Как с бюджетом?", "Всё, спасибо"

БЕРИК: "Мне нужно быть в Стамбуле 20 мая"

LIFEOS → Claude API (Action Chain):
  1. create_event({ title: "Поездка в Стамбул", date: "2026-05-20" })
  2. search_flights({ from: "Астана", to: "Стамбул", departDate: "2026-05-19" })
  3. get_weather({ city: "Istanbul", date: "2026-05-20" })
  4. convert_currency({ amount: 100000, from: "KZT", to: "TRY" })

LIFEOS (TTS): "Поездка в Стамбул записана на 20 мая! Нашёл билеты: 
              Air Astana за 85 000 тенге прямой рейс, вылет 19 мая в 06:00. 
              FlyArystan за 52 000 с пересадкой. Погода будет +22, облачно. 
              100 000 тенге — это примерно 6800 лир. 
              Забронировать Air Astana?"

[Кнопки]: "Да, бронируй", "Покажи все варианты", "Нет, посмотрю позже"

БЕРИК: "Покажи варианты и ещё найди отель"

LIFEOS → tools call: search_hotels({ city: "Стамбул", checkIn: "2026-05-19", checkOut: "2026-05-21" })

LIFEOS (TTS): "Вот варианты. Билеты: Air Astana 85 тысяч прямой, FlyArystan 52 тысячи 
              с пересадкой. Отели: Grand Hotel 25 тысяч за ночь рейтинг 4.5, 
              Bosphorus View 45 тысяч рейтинг 4.8. 
              Общий бюджет поездки: от 127 до 175 тысяч тенге. 
              Что выбираешь?"

БЕРИК: "Спасибо, LifeOS"

LIFEOS (TTS): "Не забудь — сегодня встреча с поставщиком в 14:00! 
              Хорошего дня, Берик!"

[Диалог завершён]
```

---

## ЧАСТЬ 9: КОНФИГУРАЦИЯ EXPO (app.json дополнения)

```json
{
  "expo": {
    "plugins": [
      "expo-av",
      "expo-speech",
      ["expo-calendar", { "calendarPermission": "LifeOS нужен доступ к календарю для синхронизации встреч" }],
      ["expo-contacts", { "contactsPermission": "LifeOS нужен доступ к контактам, чтобы AI мог найти нужного человека" }],
      ["expo-location", {
        "locationAlwaysAndWhenInUsePermission": "LifeOS использует GPS для трекинга активности и маршрутов",
        "locationAlwaysPermission": "LifeOS считает шаги в фоне",
        "locationWhenInUsePermission": "LifeOS строит маршруты"
      }],
      ["expo-notifications", {
        "icon": "./assets/notification-icon.png",
        "color": "#6366F1",
        "sounds": ["./assets/alarm.wav"]
      }]
    ],
    "ios": {
      "infoPlist": {
        "NSCalendarsUsageDescription": "LifeOS синхронизирует ваш календарь для умных напоминаний",
        "NSContactsUsageDescription": "LifeOS использует контакты для голосовых команд",
        "NSMicrophoneUsageDescription": "LifeOS записывает голос для управления голосом",
        "NSSpeechRecognitionUsageDescription": "LifeOS распознаёт речь для голосовых команд",
        "NSLocationAlwaysAndWhenInUseUsageDescription": "LifeOS считает шаги и строит маршруты",
        "UIBackgroundModes": ["audio", "location", "fetch", "remote-notification"]
      }
    },
    "android": {
      "permissions": [
        "RECORD_AUDIO", "READ_CALENDAR", "WRITE_CALENDAR",
        "READ_CONTACTS", "ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION",
        "RECEIVE_BOOT_COMPLETED", "VIBRATE", "READ_SMS"
      ]
    }
  }
}
```
