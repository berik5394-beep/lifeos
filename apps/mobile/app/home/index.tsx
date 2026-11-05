import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useNotifications } from '@/hooks/use-notifications';
import { useColors } from '@/hooks/use-colors';
import ChatScreen from '@/screens/chat';
import { RoomPage } from './room-page';

/**
 * Робот-эпик, Часть 3: дом приложения — два экрана со свайпом между ними
 * (схема Berik): «Комната» (слева) ↔ «Рабочий» (робот + чат, по умолчанию).
 * Инструменты — панели-шторки поверх (navigation: presentation 'modal').
 * Горизонтальный ScrollView с pagingEnabled — без новых нативных зависимостей.
 */
const WORK_PAGE = 1;

export default function HomeScreen() {
  useNotifications();
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [page, setPage] = useState(WORK_PAGE);

  // Стартуем на «Рабочем» и держим страницу при повороте/смене ширины.
  useEffect(() => {
    requestAnimationFrame(() => pager.current?.scrollTo({ x: page * width, animated: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      setPage(Math.round(e.nativeEvent.contentOffset.x / width));
    },
    [width],
  );

  return (
    <View style={styles.container}>
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        contentOffset={{ x: WORK_PAGE * width, y: 0 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width }}>
          <RoomPage active={page === 0} />
        </View>
        <View style={{ width }}>
          <ChatScreen />
        </View>
      </ScrollView>
      <View style={styles.dots} pointerEvents="none">
        {[0, 1].map((i) => (
          <View key={i} style={[styles.dot, page === i && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    dots: {
      position: 'absolute',
      top: 52,
      alignSelf: 'center',
      flexDirection: 'row',
      gap: 6,
    },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.border },
    dotActive: { backgroundColor: c.primary },
  });
}
