import React, { useEffect, useState, useMemo } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { NavigationContainer, DefaultTheme, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { storage } from '@/services/storage';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { useNotifications } from '@/hooks/use-notifications';
import { useThemeStore } from '@/stores/theme-store';
import { useUIStore } from '@/stores/ui-store';
import { registerBackgroundStepSync } from '@/services/background-steps';
import { initOfflineManager, networkMonitor, offlineQueue } from '@/services/offline-manager';
import { api } from '@/services/api';
import { setupVoiceAlarmListener } from '@/services/voice-alarm';

// Tab screens
import DashboardScreen from '@/screens/dashboard';
import TasksScreen from '@/screens/tasks';
import HabitsScreen from '@/screens/habits';
import GoalsScreen from '@/screens/goals';
import FinanceScreen from '@/screens/finance';
import ChatScreen from '@/screens/chat';

// Auth screens
import LoginScreen from '@/screens/login';
import RegisterScreen from '@/screens/register';

// Other screens — lazy loaded for faster startup
const OnboardingScreen = React.lazy(() => import('@/screens/onboarding'));
const ActivityScreen = React.lazy(() => import('@/screens/activity'));
const JournalScreen = React.lazy(() => import('@/screens/journal'));
const SettingsScreen = React.lazy(() => import('@/screens/settings'));
const IntegrationsScreen = React.lazy(() => import('@/screens/integrations'));
const ImportScreen = React.lazy(() => import('@/screens/import'));
const PetScreen = React.lazy(() => import('@/screens/pet'));
const AchievementsScreen = React.lazy(() => import('@/screens/achievements'));
const CharacterSelectScreen = React.lazy(() => import('@/screens/character-select'));
const ArenaScreen = React.lazy(() => import('@/screens/arena'));
const BattleScreen = React.lazy(() => import('@/screens/battle-screen'));
const ExerciseTrackerScreen = React.lazy(() => import('@/screens/exercise-tracker'));
const NutritionScreen = React.lazy(() => import('@/screens/nutrition'));
const ScheduleImportScreen = React.lazy(() => import('@/screens/schedule-import'));
const TaskCaptureScreen = React.lazy(() => import('@/screens/task-capture'));
const VoiceConversationScreen = React.lazy(() => import('@/screens/voice-conversation'));
const FocusModeScreen = React.lazy(() => import('@/screens/focus-mode'));
const KanbanBoardScreen = React.lazy(() => import('@/screens/kanban-board'));
const GanttViewScreen = React.lazy(() => import('@/screens/gantt-view'));
const SharedSpacesScreen = React.lazy(() => import('@/screens/shared-spaces'));
const SharedSpaceDetailScreen = React.lazy(() => import('@/screens/shared-space-detail'));
const TagManagerScreen = React.lazy(() => import('@/screens/tag-manager'));
const SubscriptionScreen = React.lazy(() => import('@/screens/subscription'));
const ExportScreen = React.lazy(() => import('@/screens/export'));
const LifeInsightsScreen = React.lazy(() => import('@/screens/life-insights'));
const SwipeHomeScreen = React.lazy(() => import('@/screens/swipe-home'));
const LegalScreen = React.lazy(() => import('@/screens/legal'));

import { ErrorBoundary } from '@/components/shared/error-boundary';
import { OfflineBanner } from '@/components/shared/offline-banner';
import type { RootStackParamList, AuthStackParamList, TabParamList } from './types';

function useNavigationTheme() {
  const theme = useThemeStore((s) => s.theme);
  return useMemo(
    () => ({
      ...DefaultTheme,
      dark: theme.statusBar === 'light', // dark mode when statusBar is light-content
      colors: {
        ...DefaultTheme.colors,
        primary: theme.primary,
        background: theme.background,
        card: theme.background,
        text: theme.text,
        border: theme.border,
        notification: theme.primary,
      },
    }),
    [theme],
  );
}

const Tab = createBottomTabNavigator<TabParamList>();

function SettingsHeaderButton() {
  const navigation = useNavigation<any>();
  const theme = useThemeStore((s) => s.theme);
  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('Settings')}
      style={{ marginRight: 16, padding: 4 }}
    >
      <Feather name="settings" size={22} color={theme.text} />
    </TouchableOpacity>
  );
}

function TabNavigator() {
  useNotifications();
  const theme = useThemeStore((s) => s.theme);
  const isFeatureVisible = useUIStore((s) => s.isFeatureVisible);

  const showFinance = isFeatureVisible('finance_tab');
  const showGoals = isFeatureVisible('goals_tab');

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: { backgroundColor: theme.tabBar, borderTopColor: theme.tabBarBorder },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '600' },
        headerRight: () => <SettingsHeaderButton />,
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Главная',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Feather name="home" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          title: 'Чат',
          tabBarIcon: ({ color, size }) => (
            <Feather name="message-circle" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Tasks"
        component={TasksScreen}
        options={{
          title: 'Задачи',
          tabBarIcon: ({ color, size }) => (
            <Feather name="check-square" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Habits"
        component={HabitsScreen}
        options={{
          title: 'Привычки',
          tabBarIcon: ({ color, size }) => (
            <Feather name="repeat" size={size} color={color} />
          ),
        }}
      />
      {showGoals && (
        <Tab.Screen
          name="Goals"
          component={GoalsScreen}
          options={{
            title: 'Цели',
            tabBarIcon: ({ color, size }) => (
              <Feather name="target" size={size} color={color} />
            ),
          }}
        />
      )}
      {showFinance && (
        <Tab.Screen
          name="Finance"
          component={FinanceScreen}
          options={{
            title: 'Финансы',
            tabBarIcon: ({ color, size }) => (
              <Feather name="dollar-sign" size={size} color={color} />
            ),
          }}
        />
      )}
    </Tab.Navigator>
  );
}

const AuthStack = createNativeStackNavigator<AuthStackParamList>();

function AuthNavigator() {
  const theme = useThemeStore((s) => s.theme);
  return (
    <AuthStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

const RootStack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  const [isReady, setIsReady] = useState(false);
  const onboardingDone = useAppStore((s) => s.onboardingDone);
  const setOnboardingDone = useAppStore((s) => s.setOnboardingDone);
  const token = useAuthStore((s) => s.token);
  const loadStoredAuth = useAuthStore((s) => s.loadStoredAuth);
  const refreshAuth = useAuthStore((s) => s.refreshAuth);

  useEffect(() => {
    (async () => {
      try {
        await storage.load();
      } catch {
        // continue with empty cache
      }
      // Initialize offline manager (network monitor + queue)
      await initOfflineManager();
      // Rehydrate theme from persisted storage (must happen after storage.load())
      useThemeStore.getState().rehydrate();
      await loadStoredAuth();
      // Auto-refresh token on app start to get fresh access token
      try {
        await refreshAuth();
      } catch {
        // If refresh fails, user will need to re-login
      }
      // Register background step counter (runs even when app is closed)
      registerBackgroundStepSync().catch(() => {
        // Non-critical — pedometer may not be available
      });
      // Sync offline queue when network is restored
      const unsubscribeNetwork = networkMonitor.onChange(async (isConnected) => {
        if (isConnected && offlineQueue.pendingCount > 0) {
          const token = useAuthStore.getState().token;
          if (!token) return;
          await offlineQueue.sync(async (mutation) => {
            // Раньше было `return res.ok || res.status === 404` — любой не-200
            // ответ считался "non-retryable" и дропался из очереди. Это ломало
            // два сценария:
            //   1. 500/502/503 (транзиентная ошибка сервера) — пользователь
            //      терял изменения вместо повторной попытки после восстановления
            //      сервера.
            //   2. 401 (access-токен истёк) — offline-мутация дропалась, хотя
            //      после рефреша токена она бы прошла.
            // Теперь:
            //   - 2xx → success
            //   - 404 → success (идемпотентный DELETE, запись уже удалена)
            //   - 4xx (400, 403, 409, 422, ...) → drop (клиентский баг / конфликт)
            //   - 401 / 408 / 429 / 5xx / network → throw → retry с backoff
            try {
              const headers: Record<string, string> = {};
              if (mutation.body !== undefined) {
                headers['Content-Type'] = 'application/json';
              }
              headers['Authorization'] = `Bearer ${token}`;
              const res = await fetch(
                `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000'}${mutation.endpoint}`,
                {
                  method: mutation.method,
                  headers,
                  body: mutation.body !== undefined ? JSON.stringify(mutation.body) : undefined,
                }
              );

              // Успешные статусы
              if (res.ok) return true;
              if (res.status === 404) return true; // идемпотентный DELETE

              // Транзиентные ошибки — бросаем, чтобы offlineQueue поставил
              // на retry (с инкрементом retryCount).
              if (
                res.status === 401 ||  // токен истёк — после рефреша пройдёт
                res.status === 408 ||  // request timeout
                res.status === 429 ||  // rate limited
                res.status >= 500      // 5xx серверные ошибки
              ) {
                throw new Error(`Transient HTTP ${res.status}`);
              }

              // 4xx (кроме 401/404/408/429) — клиентская ошибка, ретрай
              // бессмысленен. Дропаем из очереди.
              return false;
            } catch (err) {
              // Сетевые ошибки fetch (TypeError / "Network request failed")
              // + наши явные throw выше → попадают сюда и идут на retry.
              throw err instanceof Error ? err : new Error(String(err));
            }
          });
        }
      });
      // Setup voice alarm: speaks aloud when task/meeting alarm fires (respects assistant style)
      const cleanupVoiceAlarm = setupVoiceAlarmListener();

      // Check for app updates (non-blocking)
      import('@/services/version-check').then(({ checkForUpdate }) => {
        checkForUpdate().catch(() => {});
      });

      setOnboardingDone(storage.getBoolean('onboarding_complete') ?? false);
      setIsReady(true);

      return () => {
        unsubscribeNetwork();
        cleanupVoiceAlarm();
      };
    })();
  }, [loadStoredAuth, refreshAuth, setOnboardingDone]);

  const navTheme = useNavigationTheme();
  const theme = useThemeStore((s) => s.theme);

  if (!isReady) {
    return <View style={{ flex: 1, backgroundColor: theme.background }} />;
  }

  return (
    <ErrorBoundary>
    <NavigationContainer theme={navTheme}>
      <OfflineBanner />
      <React.Suspense fallback={null}>
      <RootStack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        {!onboardingDone ? (
          <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
        ) : !token ? (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        ) : (
          <>
            <RootStack.Screen name="Tabs" component={TabNavigator} />
            <RootStack.Screen
              name="Activity"
              component={ActivityScreen}
              options={{
                headerShown: true,
                title: 'Активность',
                headerStyle: { backgroundColor: theme.background },
                headerTintColor: theme.text,
                headerTitleStyle: { fontWeight: '600' },
              }}
            />
            <RootStack.Screen
              name="Journal"
              component={JournalScreen}
              options={{
                headerShown: true,
                title: 'Дневник',
                headerStyle: { backgroundColor: theme.background },
                headerTintColor: theme.text,
                headerTitleStyle: { fontWeight: '600' },
              }}
            />
            <RootStack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{
                headerShown: true,
                title: 'Настройки',
                headerStyle: { backgroundColor: theme.background },
                headerTintColor: theme.text,
                headerTitleStyle: { fontWeight: '600' },
              }}
            />
            <RootStack.Screen
              name="Integrations"
              component={IntegrationsScreen}
              options={{
                headerShown: true,
                title: 'Интеграции',
                headerStyle: { backgroundColor: theme.background },
                headerTintColor: theme.text,
                headerTitleStyle: { fontWeight: '600' },
              }}
            />
            <RootStack.Screen
              name="Import"
              component={ImportScreen}
              options={{
                headerShown: true,
                title: 'Импорт файлов',
                headerStyle: { backgroundColor: theme.background },
                headerTintColor: theme.text,
                headerTitleStyle: { fontWeight: '600' },
              }}
            />
            <RootStack.Screen name="Pet" component={PetScreen} />
            <RootStack.Screen name="Achievements" component={AchievementsScreen} />
            <RootStack.Screen name="character-select" component={CharacterSelectScreen} />
            <RootStack.Screen name="Arena" component={ArenaScreen} />
            <RootStack.Screen name="BattleScreen" component={BattleScreen} options={{ headerShown: false, animation: 'fade' }} />
            <RootStack.Screen name="ExerciseTracker" component={ExerciseTrackerScreen} options={{ headerShown: false, animation: 'slide_from_bottom' }} />
            <RootStack.Screen name="Nutrition" component={NutritionScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="ScheduleImport" component={ScheduleImportScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="TaskCapture" component={TaskCaptureScreen} options={{ headerShown: false, animation: 'slide_from_bottom' }} />
            <RootStack.Screen name="VoiceConversation" component={VoiceConversationScreen} options={{ headerShown: false, animation: 'slide_from_bottom' }} />
            <RootStack.Screen name="FocusMode" component={FocusModeScreen} options={{ headerShown: false, animation: 'slide_from_bottom' }} />
            <RootStack.Screen name="KanbanBoard" component={KanbanBoardScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="GanttView" component={GanttViewScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="SharedSpaces" component={SharedSpacesScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="SharedSpaceDetail" component={SharedSpaceDetailScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="TagManager" component={TagManagerScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="Subscription" component={SubscriptionScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="Export" component={ExportScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="LifeInsights" component={LifeInsightsScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="SwipeHome" component={SwipeHomeScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="Legal" component={LegalScreen} options={{ headerShown: false }} />
          </>
        )}
      </RootStack.Navigator>
      </React.Suspense>
    </NavigationContainer>
    </ErrorBoundary>
  );
}
