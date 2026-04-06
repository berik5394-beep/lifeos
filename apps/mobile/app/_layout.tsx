import { useEffect, useState } from 'react';
import { Redirect, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { createMMKV } from 'react-native-mmkv';
import { useAuthStore } from '@/stores/auth-store';
import { useNotifications } from '@/hooks/use-notifications';

const onboardingStorage = createMMKV({ id: 'onboarding-storage' });

export default function RootLayout() {
  const { token, loadStoredAuth } = useAuthStore();
  useNotifications();

  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);

  useEffect(() => {
    loadStoredAuth();
    const completed = onboardingStorage.getBoolean('onboarding_complete') ?? false;
    setOnboardingComplete(completed);
  }, [loadStoredAuth]);

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
      </Stack>
      {getRedirect()}
    </>
  );
}
