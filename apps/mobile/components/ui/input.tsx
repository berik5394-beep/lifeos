import React, { useState, useMemo } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { borderRadius, fontSize, spacing } from '@/constants';
import { useColors } from '@/hooks/use-colors';

interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  style?: ViewStyle;
}

export const Input = React.memo(function Input({
  label,
  error,
  style,
  ...props
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const c = useColors();
  const styles = useMemo(() => StyleSheet.create({
    container: {
      gap: spacing.xs,
    },
    label: {
      color: c.text,
      fontSize: fontSize.sm,
      fontWeight: '500',
    },
    input: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 4,
      color: c.text,
      fontSize: fontSize.md,
    },
    inputFocused: {
      borderColor: c.primary,
    },
    inputError: {
      borderColor: c.danger,
    },
    error: {
      color: c.danger,
      fontSize: fontSize.xs,
    },
  }), [c]);

  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[
          styles.input,
          focused && styles.inputFocused,
          error && styles.inputError,
        ]}
        placeholderTextColor={c.textSecondary}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={label || props.placeholder}
        accessibilityHint={error ? `Ошибка: ${error}` : undefined}
        {...props}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
});
