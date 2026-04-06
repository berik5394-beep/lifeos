import React, { useEffect } from 'react';
import { TouchableOpacity, View, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { colors, borderRadius } from '@/constants';

interface AnimatedCheckboxProps {
  checked: boolean;
  onToggle: () => void;
  size?: number;
  color?: string;
  style?: ViewStyle;
}

export const AnimatedCheckbox = React.memo(function AnimatedCheckbox({
  checked,
  onToggle,
  size = 24,
  color = colors.primary,
  style,
}: AnimatedCheckboxProps) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSequence(
      withSpring(1.3, { damping: 6, stiffness: 400 }),
      withSpring(1, { damping: 8, stiffness: 300 }),
    );
  }, [checked, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      hitSlop={8}
      style={style}
    >
      <Animated.View style={animatedStyle}>
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
      </Animated.View>
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
