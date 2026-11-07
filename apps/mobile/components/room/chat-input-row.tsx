import React, { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize } from '@/constants';
import { useSharedVoice } from '@/hooks/shared-voice';
import { useChatStore } from '@/stores/chat-store';

/**
 * Одна строка разговора с роботом под обоими экранами (инструменты ↔ комната):
 * микрофон «держи и говори», текст, отправить. Один микрофон на всё приложение.
 */
export const ChatInputRow = memo(function ChatInputRow() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const v = useSharedVoice();
  const sending = useChatStore((s) => s.isLoading);
  const [text, setText] = useState('');

  const send = useCallback(() => {
    const t = text.trim();
    if (!t || sending) return;
    setText('');
    v.setTyping(false);
    // Клавиатура закрывала облачко с ответом (оно прячется при открытой
    // клавиатуре) — ответ на напечатанное исчезал невидимым.
    Keyboard.dismiss();
    v.send(t);
  }, [text, sending, v]);

  return (
    <View style={styles.inputRow}>
      <Pressable
        style={[styles.round, v.isRecording && styles.roundActive]}
        onPressIn={() => void v.startRecording()}
        onPressOut={() => void v.stopRecording()}
        accessibilityRole="button"
        accessibilityLabel="Сказать голосом (удерживать)"
      >
        {v.isProcessing ? (
          <ActivityIndicator size="small" color={c.primary} />
        ) : (
          <Feather name="mic" size={20} color={v.isRecording ? c.text : c.textSecondary} />
        )}
      </Pressable>
      <TextInput
        style={[styles.input, v.inputHighlight && styles.glow]}
        value={text}
        onChangeText={(t) => {
          setText(t);
          v.setTyping(t.trim().length > 0);
        }}
        placeholder="Скажи роботу…"
        placeholderTextColor={c.textSecondary}
        multiline
        maxLength={2000}
      />
      <Pressable
        style={[styles.round, text.trim() ? styles.roundSend : null]}
        onPress={send}
        disabled={!text.trim() || sending}
        accessibilityRole="button"
        accessibilityLabel="Отправить"
      >
        <Feather name="send" size={19} color={text.trim() ? c.text : c.textSecondary} />
      </Pressable>
    </View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
    },
    round: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    roundActive: { backgroundColor: c.danger },
    roundSend: { backgroundColor: c.primary },
    glow: { borderWidth: 3, borderColor: c.warning },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 110,
      borderRadius: 22,
      backgroundColor: c.surface,
      color: c.text,
      fontSize: fontSize.md,
      paddingHorizontal: spacing.md,
      paddingTop: 12,
      paddingBottom: 12,
    },
  });
}
