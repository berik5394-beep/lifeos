import React from 'react';
import { KeyboardAvoidingView, StyleSheet } from 'react-native';
import { useNotifications } from '@/hooks/use-notifications';
import { useColors } from '@/hooks/use-colors';
import { RoomPage } from './room-page';

/**
 * Робот-эпик, Часть 5: дом приложения — ЕДИНСТВЕННЫЙ экран, комната робота.
 * Разговор (текст/голос) — внизу комнаты; инструменты робот достаёт из мебели
 * (карточка поверх отъехавшей комнаты). Пейджера «Комната ↔ Рабочий» больше нет.
 */
export default function HomeScreen() {
  useNotifications();
  const c = useColors();
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      // Android с edge-to-edge не сжимает окно сам — без padding клавиатура закрывает ввод.
      behavior="padding"
    >
      <RoomPage />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
