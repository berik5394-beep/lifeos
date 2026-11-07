import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { RobotAvatar } from '@/components/robot/robot-avatar';
import { RobotSpeechBubble } from '@/components/robot/robot-speech-bubble';
import { ChatReplyBubble } from '@/components/room/chat-reply-bubble';
import { TOOL_SCREEN } from '@/components/room/tool-screens';
import { ContentWidthContext, ToolActiveContext } from '@/hooks/use-content-width';
import { useColors } from '@/hooks/use-colors';
import { useRobotReaction } from '@/hooks/use-robot-reaction';
import { useSharedVoice } from '@/hooks/shared-voice';
import { useChatStore } from '@/stores/chat-store';
import { useScheduleStore } from '@/stores/schedule-store';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/services/api';
import type { PanelDef } from '@/services/panels';
import type { ToolKey } from '@/services/room-tools';
import { spacing, fontSize, borderRadius } from '@/constants';

const ROBOT = 52;
/** Своя полоса робота внизу: раньше он висел поверх инструмента и закрывал строки
 *  («Пн 2» в планере, легенды графиков, «Жильё» в финансах). */
const ROBOT_STRIP = ROBOT + spacing.xs * 2;
/** Ответ/подсказка робота лежит поверх инструмента — сам уходит, чтобы не закрывать данные. */
const BUBBLE_MS = 9000;
const FRESH_REPLY_MS = 90_000;
const VOICE_NOTE_MS = 4000;
/** Вкладка простояла дольше — при возврате перечитать данные. */
const STALE_TAB_MS = 30_000;

/**
 * Экран инструментов (Berik: «комнату отдельно, инструменты отдельно»).
 * Сверху — вкладки, под ними инструмент на весь экран; маленький робот в углу
 * отвечает и подсказывает. Свайп влево — комната робота.
 */
export const ToolsPage = memo(function ToolsPage({
  tools,
  tab,
  onTab,
  width,
}: {
  tools: PanelDef[];
  tab: ToolKey;
  onTab: (t: ToolKey) => void;
  width: number;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const token = useAuthStore((s) => s.token);
  const messages = useChatStore((s) => s.messages);
  const chatLoading = useChatStore((s) => s.isLoading);
  const confirmPendingAction = useChatStore((s) => s.confirmPendingAction);
  const voice = useSharedVoice();
  // Клавиатура открыта (пишешь в инструменте) — робот в углу закрывал бы начало строки.
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKbOpen(true));
    const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbOpen(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  const latest = messages[0];
  const reply =
    latest && latest.role === 'assistant' && Date.now() - new Date(latest.createdAt).getTime() < FRESH_REPLY_MS
      ? latest
      : undefined;
  const replyEmotion = useRobotReaction(reply?.emotion, reply?.id ?? null);
  const emotion = chatLoading ? 'thinking' : replyEmotion;

  // Ответ робота: виден, пока не смахнули; без кнопок — уходит сам.
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    if (!reply || reply.pendingAction) return;
    const t = setTimeout(() => setDismissed(reply.id), BUBBLE_MS);
    return () => clearTimeout(t);
  }, [reply]);
  const showReply = chatLoading || (!!reply && dismissed !== reply.id);

  // Голос: пока держишь — что расслышал; ошибка — подсказка.
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  useEffect(() => {
    if (!voice.error) return;
    setVoiceNote(voice.error);
    const t = setTimeout(() => setVoiceNote(null), VOICE_NOTE_MS);
    return () => clearTimeout(t);
  }, [voice.error]);
  const voiceBubble = voice.isRecording
    ? voice.liveTranscript || 'Слушаю… говори, пока держишь кнопку'
    : voice.isProcessing
      ? 'Распознаю…'
      : voiceNote;

  // Пояснение робота к вкладке (по фактам, /robot/explain) — по тапу на робота:
  // само на каждой вкладке оно ложилось бы на строку «Новая …» и тратило бюджет ИИ.
  const [explain, setExplain] = useState<{ tab: ToolKey; text: string } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    seq.current += 1;
    setExplain(null);
    setExplaining(false);
  }, [tab]);
  const askExplain = useCallback(() => {
    const my = ++seq.current;
    setExplaining(true);
    api
      .post<{ text: string }>('/robot/explain', { panel: tab }, token ?? undefined)
      .then((r) => {
        if (my === seq.current && r.text) setExplain({ tab, text: r.text });
      })
      .catch(() => {})
      .finally(() => {
        if (my === seq.current) setExplaining(false);
      });
  }, [tab, token]);
  useEffect(() => {
    if (!explain) return;
    const t = setTimeout(() => setExplain(null), BUBBLE_MS);
    return () => clearTimeout(t);
  }, [explain]);

  // Открытые вкладки живут и прячутся (раньше экран создавался заново на каждое
  // переключение: 3–5 запросов, сброс прокрутки и под-вкладки). Вернулся на
  // вкладку после 30+ с — экраны перечитывают данные (сигнал schedule-store).
  const [visited, setVisited] = useState<ToolKey[]>([tab]);
  const lastActive = useRef<Partial<Record<ToolKey, number>>>({});
  useEffect(() => {
    setVisited((v) => (v.includes(tab) ? v : [...v, tab]));
    const was = lastActive.current[tab];
    if (was != null && Date.now() - was > STALE_TAB_MS) useScheduleStore.getState().bump();
    return () => {
      lastActive.current[tab] = Date.now();
    };
  }, [tab]);
  // Выбранная вкладка — целиком и по центру полосы (раньше «Привычки» и
  // дальше оставались обрезанными у правого края).
  const tabsRef = useRef<ScrollView>(null);
  const tabLayouts = useRef<Record<string, { x: number; w: number }>>({});
  useEffect(() => {
    const l = tabLayouts.current[tab];
    if (!l) return;
    tabsRef.current?.scrollTo({ x: Math.max(0, l.x - (width - l.w) / 2), animated: true });
  }, [tab, width]);

  const bubble = voiceBubble ? (
    <ChatReplyBubble text={voiceBubble} tail="left" />
  ) : showReply ? (
    <ChatReplyBubble
      text={reply?.content ?? ''}
      thinking={chatLoading}
      tail="left"
      confirm={!chatLoading && !!reply?.pendingAction}
      onConfirm={(yes) => reply && void confirmPendingAction(reply.id, yes)}
      onDismiss={reply ? () => setDismissed(reply.id) : undefined}
    />
  ) : explaining ? (
    <ChatReplyBubble text="" thinking tail="left" />
  ) : explain && explain.tab === tab ? (
    <Pressable onPress={() => setExplain(null)} accessibilityRole="button" accessibilityLabel="Убрать подсказку робота">
      <RobotSpeechBubble text={explain.text} tail="left" />
    </Pressable>
  ) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        ref={tabsRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        style={styles.tabsBar}
      >
        {tools.map((p) => {
          const on = p.key === tab;
          return (
            <Pressable
              key={p.key}
              style={[styles.tab, on && styles.tabOn]}
              onPress={() => onTab(p.key as ToolKey)}
              onLayout={(e) => {
                tabLayouts.current[p.key] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={p.label}
            >
              <Feather name={p.icon as never} size={14} color={on ? c.text : c.textSecondary} />
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.body, !kbOpen && styles.bodyAboveRobot]}>
        <ContentWidthContext.Provider value={width}>
          {visited.map((k) => {
            const S = TOOL_SCREEN[k];
            return (
              <View key={k} style={[StyleSheet.absoluteFill, k !== tab && styles.hidden]} pointerEvents={k === tab ? 'auto' : 'none'}>
                <ToolActiveContext.Provider value={k === tab}>
                  <S />
                </ToolActiveContext.Provider>
              </View>
            );
          })}
        </ContentWidthContext.Provider>
      </View>

      {/* Маленький робот поверх инструмента, в углу; облачко — справа от него. */}
      {!kbOpen && (
      <Pressable
        style={styles.robot}
        onPress={askExplain}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Робот, что тут важного?"
      >
        <RobotAvatar emotion={emotion} size={ROBOT} attention={voice.typing || voice.isRecording ? 'listening' : 'idle'} />
      </Pressable>
      )}
      {bubble && !kbOpen && <View style={styles.bubble}>{bubble}</View>}
    </SafeAreaView>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    tabsBar: { flexGrow: 0 },
    tabs: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      height: 36,
      borderRadius: borderRadius.lg,
      backgroundColor: c.surface,
    },
    tabOn: { backgroundColor: c.primary },
    tabText: { fontSize: fontSize.sm, color: c.textSecondary, fontWeight: '600' },
    tabTextOn: { color: c.text },
    body: { flex: 1 },
    hidden: { display: 'none' },
    bodyAboveRobot: { marginBottom: ROBOT_STRIP },
    robot: { position: 'absolute', left: spacing.sm, bottom: spacing.xs },
    bubble: { position: 'absolute', left: ROBOT + spacing.sm, right: spacing.sm, bottom: spacing.xs },
  });
}
