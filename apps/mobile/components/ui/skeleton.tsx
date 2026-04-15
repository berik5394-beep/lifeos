import React, { useEffect } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated';

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 8,
  style,
}: SkeletonProps) {
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 1200 }),
      -1,
      true,
    );
  }, [shimmer]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmer.value, [0, 1], [0.3, 0.7]),
  }));

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width: width as any, height, borderRadius },
        animatedStyle,
        style,
      ]}
    />
  );
}

interface SkeletonCardProps {
  lines?: number;
  style?: ViewStyle;
}

export function SkeletonCard({ lines = 3, style }: SkeletonCardProps) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHeader}>
        <Skeleton width={40} height={40} borderRadius={20} />
        <View style={styles.cardHeaderText}>
          <Skeleton width="60%" height={14} />
          <Skeleton width="40%" height={12} style={{ marginTop: 6 }} />
        </View>
      </View>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? '70%' : '100%'}
          height={12}
          style={{ marginTop: 10 }}
        />
      ))}
    </View>
  );
}

interface SkeletonListProps {
  count?: number;
  itemHeight?: number;
  style?: ViewStyle;
}

export function SkeletonList({ count = 5, itemHeight = 56, style }: SkeletonListProps) {
  return (
    <View style={style}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.listItem, { height: itemHeight }]}>
          <Skeleton width={36} height={36} borderRadius={8} />
          <View style={styles.listItemText}>
            <Skeleton width="65%" height={14} />
            <Skeleton width="40%" height={11} style={{ marginTop: 6 }} />
          </View>
          <Skeleton width={48} height={14} borderRadius={4} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: '#334155',
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardHeaderText: {
    flex: 1,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  listItemText: {
    flex: 1,
  },
});
