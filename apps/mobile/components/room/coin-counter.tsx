import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { COMIC } from '@/constants/comic';
import { ROOM_INK, ROOM_INK_HALO } from '@/constants/room-ui';

/**
 * Робот-эпик, Часть 6: счётчик монет в углу комнаты. Заработал — над ним
 * всплывает «+N 🪙» и тает.
 */
export const CoinCounter = memo(function CoinCounter({
  coins,
  gain,
}: {
  coins: number | null;
  gain: { amount: number; seq: number } | null;
}) {
  const pop = useSharedValue(0);
  // Показанное «+N» не повторяем при новом появлении счётчика (после зума,
  // закрытия инструмента) — только новое начисление.
  const seen = useRef(gain?.seq ?? 0);
  useEffect(() => {
    if (!gain || gain.seq === seen.current) return;
    seen.current = gain.seq;
    pop.value = 0;
    pop.value = withSequence(withTiming(1, { duration: 250 }), withDelay(1300, withTiming(0, { duration: 500 })));
  }, [gain, pop]);
  const popStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ translateY: -14 * pop.value }],
  }));
  if (coins == null) return null;
  return (
    <View accessibilityLabel={`Монеты: ${coins}`}>
      <View style={styles.pill}>
        <Text style={styles.text}>🪙 {coins}</Text>
      </View>
      {gain && gain.seq !== 0 && (
        <Animated.View style={[styles.gain, popStyle]} pointerEvents="none">
          <Text style={styles.gainText}>+{gain.amount} 🪙</Text>
        </Animated.View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  // Без подложки — просто «🪙 200» поверх комнаты.
  pill: { height: 36, justifyContent: 'center' },
  text: { color: ROOM_INK, fontSize: 16, fontWeight: '800', ...ROOM_INK_HALO },
  gain: {
    position: 'absolute',
    top: 38,
    right: 0,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COMIC.ink,
    backgroundColor: COMIC.paper,
  },
  gainText: { fontFamily: COMIC.font, fontSize: 14, color: COMIC.ink },
});
