import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { storage } from '@/services/storage';
import { useAuthStore } from '@/stores/auth-store';

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const token = useAuthStore((s) => s.token);
  const loadStoredAuth = useAuthStore((s) => s.loadStoredAuth);
  const router = useRouter();
  const segments = useSegments();

  // 1. Load storage + auth on mount
  useEffect(() => {
    (async () => {
      try {
        await storage.load();
      } catch {
        // continue with empty cache
      }
      loadStoredAuth();
      setOnboardingDone(storage.getBoolean('onboarding_complete') ?? false);
      setIsReady(true);
    })();
  }, [loadStoredAuth]);

  // 2. Navigate based on state (after ready)
  useEffect(() => {
    if (!isReady) return;

    const root = segments[0] as string | undefined;

    if (!onboardingDone && root !== 'onboarding') {
      router.replace('/onboarding');
    } else if (onboardingDone && !token && root !== '(auth)') {
      router.replace('/(auth)/login');
    } else if (onboardingDone && token && (root === '(auth)' || root === 'onboarding')) {
      router.replace('/(tabs)');
    }
  }, [isReady, onboardingDone, token, segments, router]);

  if (!isReady) {
    return <View style={{ flex: 1, backgroundColor: '#0F172A' }} />;
  }

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
        <Stack.Screen name="import" options={{ headerShown: false }} />
        <Stack.Screen name="pet" options={{ headerShown: false }} />
        <Stack.Screen name="achievements" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
