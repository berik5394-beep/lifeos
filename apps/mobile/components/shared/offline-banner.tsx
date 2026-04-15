import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import NetInfo from '@react-native-community/netinfo';
import { Feather } from '@expo/vector-icons';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const translateY = useSharedValue(-50);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const offline = !(state.isConnected && state.isInternetReachable !== false);

      if (offline && !isOffline) {
        setIsOffline(true);
        translateY.value = withSpring(0, { damping: 15, stiffness: 150 });
        opacity.value = withTiming(1, { duration: 200 });
      } else if (!offline && isOffline) {
        setIsOffline(false);
        setWasOffline(true);
        // Show "back online" briefly
        setTimeout(() => {
          translateY.value = withTiming(-50, { duration: 300 });
          opacity.value = withTiming(0, { duration: 300 });
          setTimeout(() => setWasOffline(false), 400);
        }, 2000);
      }
    });

    return () => unsubscribe();
  }, [isOffline, translateY, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  if (!isOffline && !wasOffline) return null;

  return (
    <Animated.View
      style={[
        styles.banner,
        isOffline ? styles.offlineBg : styles.onlineBg,
        animatedStyle,
      ]}
    >
      <Feather
        name={isOffline ? 'wifi-off' : 'wifi'}
        size={14}
        color="#FFF"
      />
      <Text style={styles.text}>
        {isOffline ? 'Нет подключения к интернету' : 'Подключение восстановлено'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingTop: 52, // account for status bar
    zIndex: 9999,
  },
  offlineBg: {
    backgroundColor: '#EF4444',
  },
  onlineBg: {
    backgroundColor: '#22C55E',
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFF',
  },
});
