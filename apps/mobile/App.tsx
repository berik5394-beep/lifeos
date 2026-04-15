import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Navigation from './navigation';
import { useThemeStore } from '@/stores/theme-store';

// Keep splash visible while we load auth/storage
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const statusBarStyle = useThemeStore((s) => s.theme.statusBar);
  const [appReady, setAppReady] = useState(false);

  // Navigation component signals ready via onReady callback on NavigationContainer,
  // but our init logic lives inside Navigation. We hide splash after a short delay
  // to ensure the first frame is painted.
  useEffect(() => {
    // Navigation handles storage/auth loading internally.
    // We give it a moment then hide splash.
    const timer = setTimeout(() => {
      setAppReady(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (appReady) {
      await SplashScreen.hideAsync();
    }
  }, [appReady]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <StatusBar style={statusBarStyle} />
      <Navigation />
    </GestureHandlerRootView>
  );
}
