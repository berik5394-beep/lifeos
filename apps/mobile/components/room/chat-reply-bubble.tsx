import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ComicBubble, type ComicTail } from '@/components/robot/comic-bubble';
import { ComicText } from '@/components/robot/comic-text';
import { COMIC } from '@/constants/comic';

/**
 * Робот-эпик, Часть 5: ответ робота в комнате — комиксовое облачко над ним.
 * Если мозг ждёт подтверждения (деньги/необратимое) — кнопки прямо в облачке.
 */
export const ChatReplyBubble = memo(function ChatReplyBubble({
  text,
  thinking,
  tail = 'bottom',
  confirm,
  onConfirm,
  onDismiss,
}: {
  text: string;
  /** Мозг думает — облачко с «…». */
  thinking?: boolean;
  tail?: ComicTail;
  confirm?: boolean;
  onConfirm?: (yes: boolean) => void;
  onDismiss?: () => void;
}) {
  return (
    <Pressable onPress={onDismiss} accessibilityHint="Нажми, чтобы скрыть" disabled={!onDismiss}>
      <ComicBubble tail={tail}>
        {thinking ? <Text style={styles.dots}>…</Text> : <ComicText text={text} typewrite />}
        {confirm && onConfirm && (
          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.yes]} onPress={() => onConfirm(true)} accessibilityRole="button">
              <Text style={styles.btnText}>Да, записать</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => onConfirm(false)} accessibilityRole="button">
              <Text style={styles.btnText}>Отмена</Text>
            </Pressable>
          </View>
        )}
      </ComicBubble>
    </Pressable>
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
