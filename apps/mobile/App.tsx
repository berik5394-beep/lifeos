import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Navigation from './navigation';
import { useThemeStore } from '@/stores/theme-store';
import { startOfflineSync } from '@/services/offline-sync';

// Заставку прячет нативная сторона сама, как только нарисован первый кадр
// (RCTContentDidAppear). Раньше держали её из JS (preventAutoHide + hideAsync
// по setTimeout) — в релизе с UIScene (iOS 27) таймер не срабатывал до первого
// касания, и приложение «висело» на заставке.

export default function App() {
  const statusBarStyle = useThemeStore((s) => s.theme.statusBar);
  // Страховка: если нативное автоскрытие не сработало — прячем сразу после
  // монтирования (без таймера).
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    // Сеть + отправка записей, сделанных без интернета.
    startOfflineSync().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={statusBarStyle} />
      <Navigation />
    </GestureHandlerRootView>
  );
}
