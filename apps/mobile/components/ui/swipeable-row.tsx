import React, { useRef, useCallback, useMemo } from 'react';
import { View, StyleSheet, Animated, TouchableOpacity, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useColors } from '@/hooks/use-colors';

interface SwipeableRowProps {
  children: React.ReactNode;
  onDelete: () => void | Promise<void>;
  /** Текст подтверждения. Если не указан — удаляет сразу без диалога. */
  confirmText?: string;
  /** Заголовок подтверждения. По умолчанию "Удалить?" */
  confirmTitle?: string;
  /** Подпись для озвучки и кнопки в подтверждении. */
  deleteLabel?: string;
}

/**
 * Строка инструмента: чуть сдвинул влево — справа красный «минус», тап по нему
 * удаляет (Berik: «сдвинуть чуть влево и нажать минус»).
 * Если confirmText задан — показывает Alert перед удалением.
 * Иначе удаляет сразу.
 */
export const SwipeableRow = React.memo(function SwipeableRow({
  children,
  onDelete,
  confirmText,
  confirmTitle = 'Удалить?',
  deleteLabel = 'Удалить',
}: SwipeableRowProps) {
  const swipeableRef = useRef<Swipeable | null>(null);
  const c = useColors();

  const performDelete = useCallback(() => {
    swipeableRef.current?.close();
    Promise.resolve(onDelete()).catch((err) => {
      console.warn('SwipeableRow delete error:', err);
    });
  }, [onDelete]);

  const handlePress = useCallback(() => {
    if (!confirmText) {
      performDelete();
      return;
    }
    Alert.alert(confirmTitle, confirmText, [
      { text: 'Отмена', style: 'cancel', onPress: () => swipeableRef.current?.close() },
      { text: deleteLabel, style: 'destructive', onPress: performDelete },
    ]);
  }, [confirmText, confirmTitle, deleteLabel, performDelete]);

  const styles = useMemo(() => StyleSheet.create({
    action: {
      width: 64,
      justifyContent: 'center',
      alignItems: 'center',
    },
    minus: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.danger,
      justifyContent: 'center',
      alignItems: 'center',
    },
  }), [c]);

  const renderRightActions = useCallback(
    (_progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
      const scale = dragX.interpolate({
        inputRange: [-64, -24, 0],
        outputRange: [1, 0.7, 0.3],
        extrapolate: 'clamp',
      });
      return (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.action}
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
        >
          <Animated.View style={[styles.minus, { transform: [{ scale }] }]}>
            <Feather name="minus" size={22} color="#fff" />
          </Animated.View>
        </TouchableOpacity>
      );
    },
    [handlePress, deleteLabel, styles],
  );

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={1.5}
      rightThreshold={24}
      // Короткий горизонтальный сдвиг — строке; вертикальный — прокрутке списка.
      dragOffsetFromRightEdge={8}
    >
      <View>{children}</View>
    </Swipeable>
  );
});
