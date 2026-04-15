import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { spacing, fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';

interface SectionHeaderProps {
  // Small muted uppercase label above the title (e.g. "ЯНВАРЬ 2026").
  eyebrow?: string;
  // Large bold title in the body of the header (e.g. "ПРИВЫЧКИ").
  title: string;
  // Optional right-side element (counter, action button, etc.).
  right?: React.ReactNode;
  // Optional supporting subtitle rendered under the title.
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
}

// Header block inspired by the premium planner templates:
// muted eyebrow → bold all-caps title → subtle subtitle → thin divider line.
export const SectionHeader = React.memo(function SectionHeader({
  eyebrow,
  title,
  subtitle,
  right,
  style,
}: SectionHeaderProps) {
  const c = useColors();
  const styles = useMemo(() => StyleSheet.create({
    wrap: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    textCol: {
      flex: 1,
      gap: 2,
    },
    eyebrow: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      fontWeight: '800',
      letterSpacing: 1.8,
      textTransform: 'uppercase',
    },
    title: {
      color: c.text,
      fontSize: fontSize.xxl,
      fontWeight: '900',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    subtitle: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      marginTop: 2,
    },
    right: {
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    divider: {
      marginTop: spacing.md,
      height: 1,
      backgroundColor: c.divider,
    },
  }), [c]);

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        <View style={styles.textCol}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      <View style={styles.divider} />
    </View>
  );
});
