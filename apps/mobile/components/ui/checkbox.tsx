import React from 'react';
import { TouchableOpacity, View, StyleSheet, type ViewStyle } from 'react-native';
import { colors, borderRadius } from '@/constants';

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
  color = colors.primary,
  style,
}: CheckboxProps) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      hitSlop={8}
      style={style}
    >
      <View
        style={[
          styles.box,
          {
            width: size,
            height: size,
            borderColor: checked ? color : colors.border,
            backgroundColor: checked ? color : 'transparent',
          },
        ]}
      >
        {checked && <View style={styles.check} />}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
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
    borderColor: colors.text,
    transform: [{ rotate: '-45deg' }],
    marginTop: -2,
  },
});
