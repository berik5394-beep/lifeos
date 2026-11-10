import React, { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Keyboard, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/use-colors';
import { useChatStore } from '@/stores/chat-store';
import { useRobotReactionStore } from '@/stores/robot-reaction-store';
import { ChatInputRow } from './chat-input-row';
import { ChatReplyBubble } from './chat-reply-bubble';
import { ChatThreadBubble } from './chat-thread-bubble';
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
const CommandReply = memo(function CommandReply({ routeName, maxHeight }: { routeName: string; maxHeight: number }) {
  const loading = useChatStore((s) => s.isLoading);
  const confirmPendingAction = useChatStore((s) => s.confirmPendingAction);
  const route = useCurrentRoute();
  const host = route === routeName ? routeName : null;
  const { thread, open, dismiss } = useReplyBubble(host);

  if (!open) return null;
  // Весь разговор: не пропадает, пока пишешь ответ, листается вверх; убирается тапом.
  return (
    <View style={styles.reply}>
      <ChatThreadBubble
        thread={thread}
        thinking={loading}
        tail="bottom"
        maxHeight={maxHeight}
        onConfirm={(id, yes) => void confirmPendingAction(id, yes)}
        onDismiss={dismiss}
      />
    </View>
  );
});

/** Сколько держать облачко реакции на экранное действие (как на доме). */
const SCREEN_BUBBLE_MS = 9000;

/**
 * Реакция робота на действие С ЭТОГО экрана (встреча наложилась, лимит трат,
 * шаг к цели…). Раньше её видели только дом и комната: в Календаре, Сделках,
 * Дневнике, Канбане робот «молчал» (Berik 2026-11-09: робот смотрит за всем).
 * Только свежая (не проигрываем старую на новом экране), до тапа или таймера.
 */
const ScreenReaction = memo(function ScreenReaction({ routeName }: { routeName: string }) {
  const route = useCurrentRoute();
  const reaction = useRobotReactionStore((s) => s.reaction);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const hold = reaction?.holdMs ?? SCREEN_BUBBLE_MS;
  const fresh = reaction?.text && Date.now() - reaction.at < hold ? reaction : null;
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setDismissed(fresh.id), Math.max(0, hold - (Date.now() - fresh.at)));
    return () => clearTimeout(t);
  }, [fresh?.id, hold]);
  if (route !== routeName || !fresh?.text || dismissed === fresh.id) return null;
  return (
    <View style={styles.reply}>
      <ChatReplyBubble text={fresh.text} tail="bottom" onDismiss={() => setDismissed(fresh.id)} />
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
  const { height } = useWindowDimensions();
  // Облачко-диалог не выше половины свободного места — сверху остаётся экран.
  const replyMax = Math.max(120, (height - pad - insets.top - 80) * 0.6);
  const wrap = useMemo(() => [styles.bar, { backgroundColor: c.background, paddingBottom: pad }], [c.background, pad]);
  if (!routeHasCommandBar(routeName)) return <>{children}</>;
  return (
    <View style={styles.fill}>
      <View style={styles.fill}>{children}</View>
      <ScreenReaction routeName={routeName} />
      <CommandReply routeName={routeName} maxHeight={replyMax} />
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
