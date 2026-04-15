import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { spacing, borderRadius, fontSize } from '@/constants';
import type { Theme } from '@/constants/themes';

interface TagChipProps {
  name: string;
  color: string;
  onRemove?: () => void;
  size?: 'small' | 'medium';
}

const createStyles = (c: Theme, chipColor: string, size: 'small' | 'medium') =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: chipColor + '26', // ~15% opacity
      borderRadius: borderRadius.xl,
      paddingHorizontal: size === 'small' ? spacing.sm : spacing.md,
      paddingVertical: size === 'small' ? 2 : spacing.xs,
      alignSelf: 'flex-start',
    },
    text: {
      color: chipColor,
      fontSize: size === 'small' ? fontSize.xs : fontSize.sm,
      fontWeight: '600',
    },
    removeButton: {
      marginLeft: spacing.xs,
      padding: 2,
    },
  });

export const TagChip = React.memo(function TagChip({
  name,
  color: chipColor,
  onRemove,
  size = 'medium',
}: TagChipProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c, chipColor, size), [c, chipColor, size]);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{name}</Text>
      {onRemove && (
        <TouchableOpacity style={styles.removeButton} onPress={onRemove} activeOpacity={0.7}>
          <Feather name="x" size={size === 'small' ? 12 : 14} color={chipColor} />
        </TouchableOpacity>
      )}
    </View>
  );
});
