import { Redirect } from 'expo-router';
import { storage } from '@/services/storage';
import { useAuthStore } from '@/stores/auth-store';

export default function Index() {
  const token = useAuthStore((s) => s.token);
  const onboardingDone = storage.getBoolean('onboarding_complete') ?? false;

  if (!onboardingDone) {
    return <Redirect href="/onboarding" />;
  }

  if (!token) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Redirect href="/(tabs)" />;
}
