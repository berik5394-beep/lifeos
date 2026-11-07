import React, { useEffect, useState, useMemo } from 'react';
import { View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { storage } from '@/services/storage';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { useThemeStore } from '@/stores/theme-store';
import { useUIStore } from '@/stores/ui-store';
import { startOfflineSync } from '@/services/offline-sync';
import { startOtaUpdates } from '@/services/ota-updates';
import { navigationRef } from '@/navigation/ref';
import { SharedVoiceProvider } from '@/hooks/shared-voice';
import { CommandLayout } from '@/components/room/command-layout';
import { setupVoiceAlarmListener } from '@/services/voice-alarm';

// Робот-эпик, Часть 3: дом из двух экранов (Комната ↔ Рабочий) + панели-шторки
import HomeScreen from '@/screens/home';
import ChatScreen from '@/screens/chat';
import DashboardScreen from '@/screens/dashboard';
import TasksScreen from '@/screens/tasks';
import DealsScreen from '@/screens/deals';
import HabitsScreen from '@/screens/habits';
import GoalsScreen from '@/screens/goals';
import FinanceScreen from '@/screens/finance';

// Auth screens
import LoginScreen from '@/screens/login';
import RegisterScreen from '@/screens/register';

// Other screens — lazy loaded for faster startup
const OnboardingScreen = React.lazy(() => import('@/screens/onboarding'));
const JournalScreen = React.lazy(() => import('@/screens/journal'));
const SettingsScreen = React.lazy(() => import('@/screens/settings'));
const RobotMemoryScreen = React.lazy(() => import('@/screens/robot-memory'));
const RobotDiaryScreen = React.lazy(() => import('@/screens/robot-diary'));
const IntegrationsScreen = React.lazy(() => import('@/screens/integrations'));
const ImportScreen = React.lazy(() => import('@/screens/import'));
const ScheduleImportScreen = React.lazy(() => import('@/screens/schedule-import'));
const TaskCaptureScreen = React.lazy(() => import('@/screens/task-capture'));
const VoiceConversationScreen = React.lazy(() => import('@/screens/voice-conversation'));
const FocusModeScreen = React.lazy(() => import('@/screens/focus-mode'));
const KanbanBoardScreen = React.lazy(() => import('@/screens/kanban-board'));
const CalendarScreen = React.lazy(() => import('@/screens/calendar'));
const GanttViewScreen = React.lazy(() => import('@/screens/gantt-view'));
const SharedSpacesScreen = React.lazy(() => import('@/screens/shared-spaces'));
const SharedSpaceDetailScreen = React.lazy(() => import('@/screens/shared-space-detail'));
const TagManagerScreen = React.lazy(() => import('@/screens/tag-manager'));
const SubscriptionScreen = React.lazy(() => import('@/screens/subscription'));
const ExportScreen = React.lazy(() => import('@/screens/export'));
const LifeInsightsScreen = React.lazy(() => import('@/screens/life-insights'));
const LegalScreen = React.lazy(() => import('@/screens/legal'));

import { ErrorBoundary } from '@/components/shared/error-boundary';
import { jsBackOptions } from '@/components/shared/header-back';
import { OfflineBanner } from '@/components/shared/offline-banner';
import type { RootStackParamList, AuthStackParamList } from './types';

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
      // Rehydrate theme from persisted storage (must happen after storage.load())
      useThemeStore.getState().rehydrate();
      await loadStoredAuth();
      // Auto-refresh token on app start to get fresh access token
      try {
        await refreshAuth();
      } catch {
        // If refresh fails, user will need to re-login
      }
      // Setup voice alarm: speaks aloud when task/meeting alarm fires (respects assistant style)
      const cleanupVoiceAlarm = setupVoiceAlarmListener();

      // Check for app updates (non-blocking)
      import('@/services/version-check').then(({ checkForUpdate }) => {
        checkForUpdate().catch(() => {});
      });

      setOnboardingDone(storage.getBoolean('onboarding_complete') ?? false);
      setIsReady(true);
      // Сеть + отправка записей, сделанных без интернета: при запуске, при
      // появлении связи и при возврате в приложение; потом сторы перечитываются.
      startOfflineSync().catch(() => {});
      // Обновления «по воздуху»: проверка при возврате в приложение, применение в фоне.
      startOtaUpdates();

      return () => {
        cleanupVoiceAlarm();
      };
    })();
  }, [loadStoredAuth, refreshAuth, setOnboardingDone]);

  const navTheme = useNavigationTheme();
  const theme = useThemeStore((s) => s.theme);
  const isFeatureVisible = useUIStore((s) => s.isFeatureVisible);
  const showFinance = isFeatureVisible('finance_tab');
  const showGoals = isFeatureVisible('goals_tab');
  const panelOptions = {
    presentation: 'modal' as const,
    headerShown: true,
    headerStyle: { backgroundColor: theme.background },
    headerTintColor: theme.text,
    headerTitleStyle: { fontWeight: '600' as const },
  };

  if (!isReady) {
    return <View style={{ flex: 1, backgroundColor: theme.background }} />;
  }

  return (
    <ErrorBoundary>
    <NavigationContainer theme={navTheme} ref={navigationRef}>
      <OfflineBanner />
      <React.Suspense fallback={null}>
      {/* Один микрофон на всё приложение — над стеком, чтобы строка «Скажи роботу»
          работала на любом экране (раньше — только на доме). */}
      <SharedVoiceProvider>
      <RootStack.Navigator
        screenLayout={({ children, route }) => <CommandLayout routeName={route.name}>{children}</CommandLayout>}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
          // Шапкам с «назад» — по-русски (было «< Home»).
          headerBackTitle: 'Назад',
        }}
      >
        {!onboardingDone ? (
          <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
        ) : !token ? (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        ) : (
          <>
            <RootStack.Screen name="Home" component={HomeScreen} />
            {/* Панели-инструменты: нативная шторка поверх дома (робот за ней). */}
            <RootStack.Screen name="Dashboard" component={DashboardScreen} options={{ ...panelOptions, title: 'Сегодня', headerShown: false }} />
            <RootStack.Screen name="Tasks" component={TasksScreen} options={{ ...panelOptions, title: 'Задачи' }} />
            <RootStack.Screen name="Deals" component={DealsScreen} options={{ ...panelOptions, title: 'Сделки' }} />
            <RootStack.Screen name="Habits" component={HabitsScreen} options={{ ...panelOptions, title: 'Привычки' }} />
            {showGoals && <RootStack.Screen name="Goals" component={GoalsScreen} options={{ ...panelOptions, title: 'Цели' }} />}
            {showFinance && <RootStack.Screen name="Finance" component={FinanceScreen} options={{ ...panelOptions, title: 'Финансы' }} />}
            <RootStack.Screen
              name="Journal"
              component={JournalScreen}
              options={{
                presentation: 'modal',
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
              options={({ navigation }) => ({
                headerShown: true,
                title: 'Настройки',
                headerStyle: { backgroundColor: theme.background },
                headerTintColor: theme.text,
                headerTitleStyle: { fontWeight: '600' },
                ...jsBackOptions(navigation),
              })}
            />
            <RootStack.Screen
              name="Integrations"
              component={IntegrationsScreen}
              options={({ navigation }) => ({
                headerShown: true,
                title: 'Интеграции',
                headerStyle: { backgroundColor: theme.background },
                headerTintColor: theme.text,
                headerTitleStyle: { fontWeight: '600' },
                ...jsBackOptions(navigation),
              })}
            />
            <RootStack.Screen
              name="Import"
              component={ImportScreen}
              options={({ navigation }) => ({
                headerShown: true,
                title: 'Импорт файлов',
                headerStyle: { backgroundColor: theme.background },
                headerTintColor: theme.text,
                headerTitleStyle: { fontWeight: '600' },
                ...jsBackOptions(navigation),
              })}
            />
            <RootStack.Screen name="ScheduleImport" component={ScheduleImportScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="TaskCapture" component={TaskCaptureScreen} options={{ headerShown: false, animation: 'slide_from_bottom' }} />
            <RootStack.Screen name="VoiceConversation" component={VoiceConversationScreen} options={{ headerShown: false, animation: 'slide_from_bottom' }} />
            <RootStack.Screen name="FocusMode" component={FocusModeScreen} options={{ headerShown: false, animation: 'slide_from_bottom' }} />
            <RootStack.Screen name="KanbanBoard" component={KanbanBoardScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="Calendar" component={CalendarScreen} options={{ presentation: 'modal', headerShown: false }} />
            {/* История разговора с роботом (Часть 5: чат живёт в комнате, здесь — вся лента). */}
            <RootStack.Screen name="ChatHistory" component={ChatScreen} options={{ presentation: 'modal', headerShown: false }} />
            <RootStack.Screen name="GanttView" component={GanttViewScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="SharedSpaces" component={SharedSpacesScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="SharedSpaceDetail" component={SharedSpaceDetailScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="TagManager" component={TagManagerScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="Subscription" component={SubscriptionScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="Export" component={ExportScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="LifeInsights" component={LifeInsightsScreen} options={{ headerShown: false }} />
            <RootStack.Screen name="Legal" component={LegalScreen} options={{ headerShown: false }} />
            {/* Робот-друг, пункт 1: что робот о тебе помнит (с «неправда»). */}
            <RootStack.Screen
              name="RobotMemory"
              component={RobotMemoryScreen}
              options={({ navigation }) => ({
                headerShown: true,
                title: 'Что я о тебе помню',
                headerStyle: { backgroundColor: theme.background },
                headerTintColor: theme.text,
                headerTitleStyle: { fontWeight: '600' },
                ...jsBackOptions(navigation),
              })}
            />
            {/* Робот-друг, пункт 3: дневник робота о наших днях. */}
            <RootStack.Screen
              name="RobotDiary"
              component={RobotDiaryScreen}
              options={({ navigation }) => ({
                headerShown: true,
                title: 'Дневник робота',
                headerStyle: { backgroundColor: theme.background },
                headerTintColor: theme.text,
                headerTitleStyle: { fontWeight: '600' },
                ...jsBackOptions(navigation),
              })}
            />
          </>
        )}
      </RootStack.Navigator>
      </SharedVoiceProvider>
      </React.Suspense>
    </NavigationContainer>
    </ErrorBoundary>
  );
}
