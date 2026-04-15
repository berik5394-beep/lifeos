import React, { useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Alert } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';

interface SwipeableRowProps {
  children: React.ReactNode;
  onDelete: () => void | Promise<void>;
  /** Текст подтверждения. Если не указан — удаляет сразу без диалога. */
  confirmText?: string;
  /** Заголовок подтверждения. По умолчанию "Удалить?" */
  confirmTitle?: string;
  /** Что показать в красной кнопке */
  deleteLabel?: string;
}

/**
 * Универсальная строка со свайпом влево для удаления.
 * При свайпе влево показывает красную кнопку "Удалить".
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
    deleteButton: {
      backgroundColor: c.danger,
      justifyContent: 'center',
      alignItems: 'center',
      width: 88,
      marginVertical: spacing.xs,
      marginRight: spacing.md,
      borderRadius: borderRadius.md,
    },
    deleteIcon: {
      fontSize: 22,
      marginBottom: 2,
    },
    deleteText: {
      color: '#fff',
      fontSize: fontSize.xs,
      fontWeight: '700',
    },
  }), [c]);

  const renderRightActions = useCallback(
    (_progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
      const scale = dragX.interpolate({
        inputRange: [-100, -40, 0],
        outputRange: [1, 0.8, 0.5],
        extrapolate: 'clamp',
      });
      return (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.deleteButton}
          onPress={handlePress}
        >
          <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
            <Text style={styles.deleteIcon}>🗑</Text>
            <Text style={styles.deleteText}>{deleteLabel}</Text>
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
      friction={2}
      rightThreshold={40}
    >
      <View>{children}</View>
    </Swipeable>
  );
});
