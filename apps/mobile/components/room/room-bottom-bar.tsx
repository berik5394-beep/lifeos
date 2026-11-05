import React, { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import type { PanelDef } from '@/services/panels';

type Shelf = 'tools' | 'furnish' | null;

/**
 * Робот-эпик, Часть 5: низ единственного экрана-комнаты. Две полки по кнопке
 * («Инструменты» — робот достанет из мебели, «Обставить» — каталог мебели) и
 * строка разговора с роботом: текст или микрофон (удерживать).
 */
export const RoomBottomBar = memo(function RoomBottomBar({
  tools,
  onTool,
  shop,
  onShelfChange,
  onSend,
  sending,
  isRecording,
  isProcessing,
  onMicIn,
  onMicOut,
  onTyping,
  highlight = null,
}: {
  tools: PanelDef[];
  onTool: (key: string) => void;
  /** Часть 6: магазин ремонта (полка «Обставить»). */
  shop: ReactNode;
  /** Открыли/закрыли полку — комната подсвечивает ячейки, грузит каталог. */
  onShelfChange?: (shelf: 'tools' | 'furnish' | null) => void;
  onSend: (text: string) => void;
  sending: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  onMicIn: () => void;
  onMicOut: () => void;
  /** Юзер пишет — робот «слушает». */
  onTyping?: (typing: boolean) => void;
  /** Знакомство: подсветить кнопку/строку, о которой говорит робот. */
  highlight?: 'input' | 'tools' | 'furnish' | null;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [shelf, setShelf] = useState<Shelf>(null);
  const [text, setText] = useState('');

  const toggle = useCallback((s: Exclude<Shelf, null>) => setShelf((cur) => (cur === s ? null : s)), []);
  useEffect(() => onShelfChange?.(shelf), [shelf, onShelfChange]);
  const send = useCallback(() => {
    const t = text.trim();
    if (!t || sending) return;
    setText('');
    onTyping?.(false);
    onSend(t);
  }, [text, sending, onSend, onTyping]);

  return (
    <View style={styles.wrap}>
      <View style={styles.toggles}>
        <Pressable
          style={[styles.toggle, shelf === 'tools' && styles.toggleOn, highlight === 'tools' && styles.glow]}
          onPress={() => toggle('tools')}
          accessibilityRole="button"
          accessibilityLabel="Инструменты"
        >
          <Feather name="grid" size={15} color={c.text} />
          <Text style={styles.toggleText}>Инструменты</Text>
        </Pressable>
        <Pressable
          style={[styles.toggle, shelf === 'furnish' && styles.toggleOn, highlight === 'furnish' && styles.glow]}
          onPress={() => toggle('furnish')}
          accessibilityRole="button"
          accessibilityLabel="Обставить комнату"
        >
          <Feather name="home" size={15} color={c.text} />
          <Text style={styles.toggleText}>Обставить</Text>
        </Pressable>
      </View>

      {shelf === 'tools' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
          {tools.map((p) => (
            <Pressable
              key={p.key}
              style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
              onPress={() => {
                setShelf(null);
                onTool(p.key);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Достать: ${p.label}`}
            >
              <Feather name={p.icon as never} size={14} color={c.primary} />
              <Text style={styles.chipText}>{p.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {shelf === 'furnish' && (
        <View style={styles.shelfFurnish}>{shop}</View>
      )}

      <View style={styles.inputRow}>
        <Pressable
          style={[styles.round, isRecording && styles.roundActive]}
          onPressIn={onMicIn}
          onPressOut={onMicOut}
          accessibilityRole="button"
          accessibilityLabel="Сказать голосом (удерживать)"
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={c.primary} />
          ) : (
            <Feather name="mic" size={20} color={isRecording ? c.text : c.textSecondary} />
          )}
        </Pressable>
        <TextInput
          style={[styles.input, highlight === 'input' && styles.glow]}
          value={text}
          onChangeText={(t) => {
            setText(t);
            onTyping?.(t.trim().length > 0);
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
    </View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    wrap: { paddingTop: spacing.xs, paddingBottom: spacing.sm, gap: spacing.xs },
    toggles: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 7,
      borderRadius: borderRadius.lg,
      backgroundColor: c.surface,
    },
    toggleOn: { backgroundColor: c.surfaceLight },
    // Подсветка на знакомстве — яркая рамка, как маркер в комиксе.
    glow: { borderWidth: 3, borderColor: c.warning },
    toggleText: { fontSize: fontSize.sm, color: c.text, fontWeight: '600' },
    shelf: { gap: spacing.sm, paddingHorizontal: spacing.md },
    shelfFurnish: {},
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      height: 40,
      borderRadius: borderRadius.lg,
      backgroundColor: c.surface,
    },
    chipPressed: { backgroundColor: c.surfaceLight },
    chipText: { fontSize: fontSize.sm, color: c.text },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.md },
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
