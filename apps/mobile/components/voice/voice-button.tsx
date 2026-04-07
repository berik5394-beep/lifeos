import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';

interface VoiceButtonProps {
  onPress: () => void;
  isRecording: boolean;
  isProcessing: boolean;
  style?: ViewStyle;
}

const BUTTON_SIZE = 64;

export const VoiceButton = React.memo(function VoiceButton({
  onPress,
  isRecording,
  isProcessing,
  style,
}: VoiceButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isRecording) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.15, duration: 600, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      );
      loopRef.current = anim;
      anim.start();
    } else {
      if (loopRef.current) {
        loopRef.current.stop();
        loopRef.current = null;
      }
      scale.stopAnimation();
      Animated.timing(scale, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [isRecording, scale]);

  const backgroundColor = isRecording ? colors.danger : colors.primary;

  return (
    <Animated.View style={[styles.wrapper, { transform: [{ scale }] }, style]}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        style={[styles.button, { backgroundColor }]}
        disabled={isProcessing}
      >
        {isProcessing ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : (
          <Feather
            name={isRecording ? 'mic-off' : 'mic'}
            size={28}
            color={colors.text}
          />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
});
