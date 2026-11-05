import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Navigation from './navigation';
import { useThemeStore } from '@/stores/theme-store';

// Keep splash visible while we load auth/storage
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const statusBarStyle = useThemeStore((s) => s.theme.statusBar);
  // Прячем заставку после первого кадра. Раньше это висело на onLayout корня:
  // onLayout срабатывает один раз — ДО того, как appReady стал true, — и
  // hideAsync не вызывался никогда (заставка зависала). Теперь — эффект.
  useEffect(() => {
    const timer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={statusBarStyle} />
      <Navigation />
    </GestureHandlerRootView>
  );
}
