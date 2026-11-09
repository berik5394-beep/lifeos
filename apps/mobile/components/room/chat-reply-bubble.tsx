import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { ComicBubble, type ComicTail } from '@/components/robot/comic-bubble';
import { ComicText } from '@/components/robot/comic-text';
import { COMIC } from '@/constants/comic';

/** Смахнул облачко на столько — убрать. */
const SWIPE_AWAY = 40;

/**
 * Робот-эпик, Часть 5: ответ робота в комнате — комиксовое облачко над ним.
 * Если мозг ждёт подтверждения (деньги/необратимое) — кнопки прямо в облачке.
 * Убирается тапом или смахиванием (само не исчезает — Berik 2026-11-09).
 * horizontalOnly — облачко внутри вертикальной прокрутки (длинный ответ).
 */
export const ChatReplyBubble = memo(function ChatReplyBubble({
  text,
  thinking,
  tail = 'bottom',
  confirm,
  onConfirm,
  onDismiss,
  horizontalOnly,
}: {
  text: string;
  /** Мозг думает — облачко с «…». */
  thinking?: boolean;
  tail?: ComicTail;
  confirm?: boolean;
  onConfirm?: (yes: boolean) => void;
  onDismiss?: () => void;
  horizontalOnly?: boolean;
}) {
  const swipe = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(!!onDismiss)
      .runOnJS(true)
      .activeOffsetX([-15, 15])
      .onEnd((e) => {
        const far = Math.abs(e.translationX) > SWIPE_AWAY || (!horizontalOnly && Math.abs(e.translationY) > SWIPE_AWAY);
        if (far) onDismiss?.();
      });
    return horizontalOnly ? pan.failOffsetY([-12, 12]) : pan.activeOffsetY([-15, 15]);
  }, [onDismiss, horizontalOnly]);
  return (
    <GestureDetector gesture={swipe}>
    <Pressable onPress={onDismiss} accessibilityHint="Нажми или смахни, чтобы скрыть" disabled={!onDismiss}>
      <ComicBubble tail={tail}>
        {thinking ? <Text style={styles.dots}>…</Text> : <ComicText text={text} typewrite />}
        {confirm && onConfirm && (
          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.yes]} onPress={() => onConfirm(true)} accessibilityRole="button">
              <Text style={styles.btnText}>Подтвердить</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => onConfirm(false)} accessibilityRole="button">
              <Text style={styles.btnText}>Отмена</Text>
            </Pressable>
          </View>
        )}
      </ComicBubble>
    </Pressable>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
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
});
