import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  Dimensions,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SlideTab {
  key: string;
  title: string;
  icon?: string;
}

interface SlideTabsProps {
  tabs: SlideTab[];
  children: React.ReactNode[];
  initialTab?: number;
}

export const SlideTabs = React.memo(function SlideTabs({
  tabs,
  children,
  initialTab = 0,
}: SlideTabsProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(initialTab);
  const scrollX = useRef(new Animated.Value(initialTab * SCREEN_WIDTH)).current;
  const c = useColors();

  const handleTabPress = useCallback(
    (index: number) => {
      scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
      setActiveIndex(index);
    },
    [],
  );

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    { useNativeDriver: false },
  );

  const handleMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
      setActiveIndex(idx);
    },
    [],
  );

  const tabWidth = SCREEN_WIDTH / tabs.length;
  const indicatorWidth = tabWidth - spacing.md * 2;

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
    },
    tabBar: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      position: 'relative',
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.sm + 2,
      gap: 6,
    },
    tabIcon: {
      fontSize: fontSize.md,
    },
    tabText: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      fontWeight: '500',
    },
    tabTextActive: {
      color: c.primary,
      fontWeight: '700',
    },
    indicator: {
      position: 'absolute',
      bottom: 0,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: c.primary,
    },
    page: {
      width: SCREEN_WIDTH,
    },
  }), [c]);

  return (
    <View style={styles.container}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        {tabs.map((tab, i) => {
          const isActive = activeIndex === i;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => handleTabPress(i)}
              style={[styles.tab, { width: tabWidth }]}
              activeOpacity={0.7}
            >
              {tab.icon ? <Text style={styles.tabIcon}>{tab.icon}</Text> : null}
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab.title}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Animated indicator line */}
        <Animated.View
          style={[
            styles.indicator,
            {
              width: indicatorWidth,
              transform: [
                {
                  translateX: scrollX.interpolate({
                    inputRange: tabs.map((_, i) => i * SCREEN_WIDTH),
                    outputRange: tabs.map((_, i) => i * tabWidth + spacing.md),
                    extrapolate: 'clamp',
                  }),
                },
              ],
            },
          ]}
        />
      </View>

      {/* Swipeable content */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleMomentumEnd}
        scrollEventThrottle={16}
        decelerationRate="fast"
        contentOffset={{ x: initialTab * SCREEN_WIDTH, y: 0 }}
      >
        {children.map((child, i) => (
          <View key={tabs[i]?.key ?? String(i)} style={styles.page}>
            {child}
          </View>
        ))}
      </ScrollView>
    </View>
  );
});
