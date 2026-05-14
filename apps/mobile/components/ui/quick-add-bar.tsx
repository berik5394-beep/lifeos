import React, { useState, useMemo, useCallback } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { spacing, borderRadius, fontSize } from '@/constants';
import type { Theme } from '@/constants/themes';

interface QuickAddBarProps {
  onSubmit: (text: string) => void;
  placeholder?: string;
  loading?: boolean;
}

const createStyles = (c: Theme) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    input: {
      flex: 1,
      color: c.text,
      fontSize: fontSize.md,
      paddingVertical: spacing.sm,
    },
    micButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: spacing.sm,
    },
  });

export const QuickAddBar = React.memo(function QuickAddBar({
  onSubmit,
  placeholder = 'Быстрое добавление...',
  loading = false,
}: QuickAddBarProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [text, setText] = useState('');

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
    setText('');
  }, [text, onSubmit]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={c.textSecondary}
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        editable={!loading}
      />
      <TouchableOpacity
        style={styles.micButton}
        onPress={handleSubmit}
        disabled={loading}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Добавить"
        accessibilityState={{ disabled: loading }}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Feather name="mic" size={20} color="#fff" />
        )}
      </TouchableOpacity>
    </View>
  );
});
