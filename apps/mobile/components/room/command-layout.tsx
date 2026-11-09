import React, { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/use-colors';
import { useChatStore } from '@/stores/chat-store';
import { ChatInputRow } from './chat-input-row';
import { ChatReplyBubble } from './chat-reply-bubble';
import { spacing } from '@/constants';
import { routeHasCommandBar } from '@/services/command-bar';
import { useCurrentRoute, useReplyBubble } from '@/hooks/use-reply-bubble';



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

/**
 * Ответ робота облачком над строкой (с кнопками, если ждёт «да»). Одно облачко
 * на всё приложение (use-reply-bubble): только на экране перед глазами, до
 * тапа/смахивания; новый экран не показывает старый ответ заново.
 */
const CommandReply = memo(function CommandReply({ routeName }: { routeName: string }) {
  const loading = useChatStore((s) => s.isLoading);
  const confirmPendingAction = useChatStore((s) => s.confirmPendingAction);
  const route = useCurrentRoute();
  const host = route === routeName ? routeName : null;
  const { reply, dismiss } = useReplyBubble(host);

  if (loading && host) return <View style={styles.reply}><ChatReplyBubble text="" thinking tail="bottom" /></View>;
  if (!reply) return null;
  return (
    <View style={styles.reply}>
      <ChatReplyBubble
        text={reply.content}
        tail="bottom"
        confirm={!!reply.pendingAction}
        onConfirm={(yes) => void confirmPendingAction(reply.id, yes)}
        onDismiss={dismiss}
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
      <CommandReply routeName={routeName} />
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
