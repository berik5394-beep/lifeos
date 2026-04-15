import React, { useMemo } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { borderRadius, fontSize, spacing } from '@/constants';
import { useColors } from '@/hooks/use-colors';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export const Button = React.memo(function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const c = useColors();
  const styles = useMemo(() => StyleSheet.create({
    base: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: borderRadius.md,
    },
    variant_primary: {
      backgroundColor: c.primary,
    },
    variant_secondary: {
      backgroundColor: c.secondary,
    },
    variant_outline: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: c.primary,
    },
    variant_danger: {
      backgroundColor: c.danger,
    },
    size_sm: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      height: 36,
    },
    size_md: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      height: 48,
    },
    size_lg: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xl,
      height: 56,
    },
    disabled: {
      opacity: 0.5,
    },
    text: {
      color: c.text,
      fontWeight: '600',
    },
    text_sm: {
      fontSize: fontSize.sm,
    },
    text_md: {
      fontSize: fontSize.md,
    },
    text_lg: {
      fontSize: fontSize.lg,
    },
    textOutline: {
      color: c.primary,
    },
  }), [c]);

  const buttonStyles: ViewStyle[] = [
    styles.base,
    styles[`variant_${variant}`],
    styles[`size_${size}`],
    (disabled || loading) && styles.disabled,
    style,
  ].filter(Boolean) as ViewStyle[];

  const textStyles: TextStyle[] = [
    styles.text,
    styles[`text_${size}`],
    variant === 'outline' && styles.textOutline,
  ].filter(Boolean) as TextStyle[];

  return (
    <TouchableOpacity
      style={buttonStyles}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading }}
    >
      {loading ? (
        <ActivityIndicator color={c.text} size="small" />
      ) : (
        <Text style={textStyles}>{title}</Text>
      )}
    </TouchableOpacity>
  );
});
