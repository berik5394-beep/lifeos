import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize } from '@/constants';
import { useSharedVoice } from '@/hooks/shared-voice';
import { useChatStore } from '@/stores/chat-store';
import { useCurrentRoute } from '@/hooks/use-reply-bubble';

let rowSeq = 0;

/**
 * Одна строка разговора с роботом под обоими экранами (инструменты ↔ комната):
 * микрофон (нажми — говори — отправь, или держи и отпусти), текст, отправить.
 * Один микрофон на всё приложение.
 */
export const ChatInputRow = memo(function ChatInputRow() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const v = useSharedVoice();
  const sending = useChatStore((s) => s.isLoading);
  const [text, setText] = useState('');
  // Не дошло до робота (нет сети, сбой) — вернуть текст в строку, а не терять.
  const [rowId] = useState(() => `row-${++rowSeq}`);
  const failedDraft = useChatStore((s) => s.failedDraft);
  useEffect(() => {
    if (failedDraft === null) return;
    const d = useChatStore.getState().takeFailedDraft(rowId);
    if (d) setText((cur) => (cur ? cur : d));
  }, [failedDraft, rowId]);

  // Пример из «Как пользоваться» — вставить в строку на нужном экране: поправил и ➤.
  // Не отправляем сами: «Встреча с Сериком завтра» создала бы настоящую встречу.
  const route = useCurrentRoute();
  const prefill = useChatStore((s) => s.prefill);
  useEffect(() => {
    if (!prefill || route !== prefill.for) return;
    setText(prefill.text);
    v.setTyping(true);
    useChatStore.getState().setPrefill(null);
  }, [prefill, route, v]);

  const send = useCallback(() => {
    const t = text.trim();
    if (!t || sending) return;
    setText('');
    v.setTyping(false);
    // Клавиатура закрывала облачко с ответом (оно прячется при открытой
    // клавиатуре) — ответ на напечатанное исчезал невидимым.
    Keyboard.dismiss();
    useChatStore.setState({ draftOwner: rowId });
    v.send(t);
  }, [text, sending, v, rowId]);

  // Запись зафиксирована коротким нажатием (как в WhatsApp): слева «отмена»,
  // посередине — что расслышал, справа «отправить».
  if (v.locked) {
    return (
      <View style={styles.inputRow}>
        <Pressable
          style={styles.round}
          onPress={() => void v.cancelRecording()}
          accessibilityRole="button"
          accessibilityLabel="Отменить запись"
        >
          <Feather name="x" size={20} color={c.textSecondary} />
        </Pressable>
        <View style={[styles.input, styles.listening]}>
          <View style={styles.dot} />
          <Text style={styles.listeningText} numberOfLines={2}>
            {v.liveTranscript || 'Слушаю… говори, потом нажми «отправить»'}
          </Text>
        </View>
        <Pressable
          style={[styles.round, styles.roundSend]}
          onPress={() => void v.sendRecording()}
          accessibilityRole="button"
          accessibilityLabel="Отправить сказанное"
        >
          <Feather name="send" size={19} color={c.text} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.inputRow}>
      <Pressable
        style={[styles.round, v.isRecording && styles.roundActive]}
        onPressIn={() => void v.startRecording()}
        onPressOut={() => void v.stopRecording()}
        accessibilityRole="button"
        accessibilityLabel="Голос: нажми — говори — отправь; или держи и отпусти"
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
    listening: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger },
    listeningText: { flex: 1, color: c.text, fontSize: fontSize.md },
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
