import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { storage } from '@/services/storage';
import { useAuthStore } from '@/stores/auth-store';
import { useNotifications } from '@/hooks/use-notifications';

export default function RootLayout() {
  const { token, loadStoredAuth } = useAuthStore();
  useNotifications();

  const [storageReady, setStorageReady] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);

  useEffect(() => {
    storage.load().then(() => setStorageReady(true));
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    loadStoredAuth();
    const completed = storage.getBoolean('onboarding_complete') ?? false;
    setOnboardingComplete(completed);
  }, [storageReady, loadStoredAuth]);

  if (!storageReady) {
    return <View style={{ flex: 1, backgroundColor: '#0F172A' }} />;
  }

  const getRedirect = () => {
    if (onboardingComplete === null) {
      return null;
    }
    if (!onboardingComplete) {
      return <Redirect href="/onboarding" />;
    }
    if (token) {
      return <Redirect href="/(tabs)" />;
    }
    return <Redirect href="/(auth)/login" />;
  };

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0F172A' },
          headerTintColor: '#F8FAFC',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#0F172A' },
        }}
      >
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="activity" options={{ headerShown: false }} />
        <Stack.Screen name="journal" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="pet" options={{ headerShown: false }} />
        <Stack.Screen name="achievements" options={{ headerShown: false }} />
      </Stack>
      {getRedirect()}
    </>
  );
}
