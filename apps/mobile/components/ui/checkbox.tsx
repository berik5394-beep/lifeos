import React, { useMemo } from 'react';
import { TouchableOpacity, View, StyleSheet, type ViewStyle } from 'react-native';
import { borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';

interface CheckboxProps {
  checked: boolean;
  onToggle: () => void;
  size?: number;
  color?: string;
  style?: ViewStyle;
}

export const Checkbox = React.memo(function Checkbox({
  checked,
  onToggle,
  size = 24,
  color,
  style,
}: CheckboxProps) {
  const c = useColors();
  const resolvedColor = color ?? c.primary;
  const styles = useMemo(() => StyleSheet.create({
    box: {
      borderWidth: 2,
      borderRadius: borderRadius.sm / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    check: {
      width: 10,
      height: 6,
      borderLeftWidth: 2,
      borderBottomWidth: 2,
      borderColor: c.text,
      transform: [{ rotate: '-45deg' }],
      marginTop: -2,
    },
  }), [c]);

  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      hitSlop={8}
      style={style}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View
        style={[
          styles.box,
          {
            width: size,
            height: size,
            borderColor: checked ? resolvedColor : c.border,
            backgroundColor: checked ? resolvedColor : 'transparent',
          },
        ]}
      >
        {checked && <View style={styles.check} />}
      </View>
    </TouchableOpacity>
  );
});
