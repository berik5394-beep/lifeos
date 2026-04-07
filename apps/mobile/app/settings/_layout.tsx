import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0F172A' },
        headerTintColor: '#F8FAFC',
        contentStyle: { backgroundColor: '#0F172A' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Настройки' }} />
      <Stack.Screen name="integrations" options={{ title: 'Интеграции' }} />
    </Stack>
  );
}
