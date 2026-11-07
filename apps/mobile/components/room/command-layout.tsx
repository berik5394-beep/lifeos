import React, { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/use-colors';
import { useChatStore } from '@/stores/chat-store';
import { ChatInputRow } from './chat-input-row';
import { ChatReplyBubble } from './chat-reply-bubble';
import { spacing } from '@/constants';
import { routeHasCommandBar } from '@/services/command-bar';


/** Ответ робота виден столько, если не ждёт подтверждения. */
const BUBBLE_MS = 9000;
const FRESH_REPLY_MS = 90_000;

/** Высота клавиатуры (0 — закрыта). Своя, т.к. KeyboardAvoidingView под нативной шапкой промахивается на её высоту. */
function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return h;
}

/** Последний свежий ответ робота облачком над строкой (с кнопками, если ждёт «да»). */
const CommandReply = memo(function CommandReply() {
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.isLoading);
  const confirmPendingAction = useChatStore((s) => s.confirmPendingAction);
  const latest = messages[0];
  const reply =
    latest && latest.role === 'assistant' && Date.now() - new Date(latest.createdAt).getTime() < FRESH_REPLY_MS ? latest : undefined;
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    if (!reply || reply.pendingAction) return;
    const t = setTimeout(() => setDismissed(reply.id), BUBBLE_MS);
    return () => clearTimeout(t);
  }, [reply]);

  if (loading) return <View style={styles.reply}><ChatReplyBubble text="" thinking tail="bottom" /></View>;
  if (!reply || dismissed === reply.id) return null;
  return (
    <View style={styles.reply}>
      <ChatReplyBubble
        text={reply.content}
        tail="bottom"
        confirm={!!reply.pendingAction}
        onConfirm={(yes) => void confirmPendingAction(reply.id, yes)}
        onDismiss={() => setDismissed(reply.id)}
      />
    </View>
  );
});

/**
 * Строка «Скажи роботу» + ответ робота на ЛЮБОМ экране стека (Настройки,
 * Канбан, Фокус, Камера, Гант…). Раньше команда уходила только с дома —
 * с остальных экранов приходилось выходить назад.
 */
export const CommandLayout = memo(function CommandLayout({ routeName, children }: { routeName: string; children: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  // Экран тянется до низа экрана: открыта клавиатура — строка прямо над ней,
  // закрыта — над полоской «домой».
  const pad = kb > 0 ? kb : insets.bottom;
  const wrap = useMemo(() => [styles.bar, { backgroundColor: c.background, paddingBottom: pad }], [c.background, pad]);
  if (!routeHasCommandBar(routeName)) return <>{children}</>;
  return (
    <View style={styles.fill}>
      <View style={styles.fill}>{children}</View>
      <CommandReply />
      <View style={wrap}>
        <ChatInputRow />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  reply: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  bar: {},
});
