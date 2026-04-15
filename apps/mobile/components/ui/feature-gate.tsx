import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { spacing, borderRadius, fontSize } from '@/constants';
import type { Theme } from '@/constants/themes';

// These stores will be created by Stream B
// import { useUIStore } from '@/stores/ui-store';

interface FeatureGateProps {
  feature: string;
  children: React.ReactNode;
  visible?: boolean;
  showUpgradePrompt?: boolean;
  onUpgrade?: () => void;
}

const createStyles = (c: Theme) =>
  StyleSheet.create({
    upgradeContainer: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.lg,
      alignItems: 'center',
    },
    lockIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.primary + '1A',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    upgradeTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.text,
      marginBottom: spacing.xs,
    },
    upgradeText: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      textAlign: 'center',
      marginBottom: spacing.md,
    },
    upgradeButton: {
      backgroundColor: c.primary,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    upgradeButtonText: {
      color: '#fff',
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
  });

export const FeatureGate = React.memo(function FeatureGate({
  feature,
  children,
  visible = true,
  showUpgradePrompt = false,
  onUpgrade,
}: FeatureGateProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  // When useUIStore is available, replace with:
  // const isVisible = useUIStore((s) => s.isFeatureVisible(feature));
  const isVisible = visible;

  if (!isVisible) {
    if (showUpgradePrompt) {
      return (
        <View style={styles.upgradeContainer}>
          <View style={styles.lockIcon}>
            <Feather name="lock" size={24} color={c.primary} />
          </View>
          <Text style={styles.upgradeTitle}>PRO функция</Text>
          <Text style={styles.upgradeText}>
            Эта функция доступна в PRO версии. Обновитесь для полного доступа.
          </Text>
          {onUpgrade && (
            <TouchableOpacity style={styles.upgradeButton} onPress={onUpgrade} activeOpacity={0.7}>
              <Text style={styles.upgradeButtonText}>Перейти на PRO</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    return null;
  }

  return <>{children}</>;
});
