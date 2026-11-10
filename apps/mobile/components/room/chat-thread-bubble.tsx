import React, { memo, useCallback, useMemo, useRef } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { ComicBubble, type ComicTail } from '@/components/robot/comic-bubble';
import { ComicText } from '@/components/robot/comic-text';
import { COMIC } from '@/constants/comic';
import type { ChatMessage } from '@/stores/chat-store';

/** Смахнул облачко вбок на столько — убрать. */
const SWIPE_AWAY = 40;
/** Ближе к низу, чем столько, — «внизу»: новые слова прокручивают к себе. */
const NEAR_BOTTOM = 48;

/**
 * Облачко-диалог (Berik 2026-11-10): весь текущий разговор с роботом, а не
 * только последний ответ. Не пропадает, когда пишешь ответ; листается вверх до
 * начала разговора; убирается ТОЛЬКО тапом (по облачку или по «✕») или
 * смахиванием вбок.
 */
export const ChatThreadBubble = memo(function ChatThreadBubble({
  thread,
  thinking,
  tail = 'bottom',
  maxHeight,
  onConfirm,
  onDismiss,
}: {
  /** Реплики разговора, старые первыми. */
  thread: ChatMessage[];
  /** Робот думает — «…» в конце. */
  thinking?: boolean;
  tail?: ComicTail;
  /** Выше облачко не растёт — дальше листается (над ним остаётся место). */
  maxHeight: number;
  onConfirm?: (id: string, yes: boolean) => void;
  onDismiss: () => void;
}) {
  const scroll = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - NEAR_BOTTOM;
  }, []);
  // Новые слова/реплики — к низу, если не листаешь историю вверху.
  const onContentSizeChange = useCallback(() => {
    if (atBottom.current) scroll.current?.scrollToEnd({ animated: false });
  }, []);

  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-15, 15])
        .failOffsetY([-12, 12])
        .onEnd((e) => {
          if (Math.abs(e.translationX) > SWIPE_AWAY) onDismiss();
        }),
    [onDismiss],
  );

  const last = thread[thread.length - 1];
  const live = !thinking && last?.role === 'assistant' ? last.id : null;

  return (
    <GestureDetector gesture={swipe}>
      <View>
        <ComicBubble tail={tail}>
          <ScrollView
            ref={scroll}
            style={{ maxHeight }}
            bounces={false}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll}
            scrollEventThrottle={64}
            onContentSizeChange={onContentSizeChange}
          >
            <Pressable onPress={onDismiss} accessibilityHint="Нажми, чтобы скрыть разговор">
              {thread.map((m) =>
                m.role === 'user' ? (
                  <View key={m.id} style={styles.user}>
                    <Text style={styles.userText}>{m.content}</Text>
                  </View>
                ) : (
                  <View key={m.id} style={styles.robot}>
                    <ComicText text={m.content} typewrite={m.id === live} />
                    {m.pendingAction && onConfirm && (
                      <View style={styles.actions}>
                        <Pressable style={[styles.btn, styles.yes]} onPress={() => onConfirm(m.id, true)} accessibilityRole="button">
                          <Text style={styles.btnText}>Подтвердить</Text>
                        </Pressable>
                        <Pressable style={styles.btn} onPress={() => onConfirm(m.id, false)} accessibilityRole="button">
                          <Text style={styles.btnText}>Отмена</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                ),
              )}
              {thinking && <Text style={styles.dots}>…</Text>}
            </Pressable>
          </ScrollView>
        </ComicBubble>
        {/* Отдельное место для тапа «убрать» — не промахнёшься мимо текста. */}
        <Pressable
          style={styles.close}
          onPress={onDismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Скрыть разговор"
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  robot: { marginBottom: 10, paddingRight: 18 },
  user: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COMIC.ink,
    backgroundColor: COMIC.userPaper,
  },
  userText: { fontFamily: COMIC.font, fontSize: 14, lineHeight: 19, color: COMIC.ink },
  dots: { fontFamily: COMIC.font, fontSize: 22, color: COMIC.ink, letterSpacing: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COMIC.ink,
    backgroundColor: COMIC.paper,
  },
  yes: { backgroundColor: COMIC.userPaper },
  btnText: { fontFamily: COMIC.font, fontSize: 14, color: COMIC.ink },
  close: {
    position: 'absolute',
    top: -10,
    right: -6,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: COMIC.ink,
    backgroundColor: COMIC.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontFamily: COMIC.font, fontSize: 14, color: COMIC.ink },
});
