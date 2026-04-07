import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { storage } from '@/services/storage';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { useNotifications } from '@/hooks/use-notifications';

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

// Other screens
import OnboardingScreen from '@/screens/onboarding';
import ActivityScreen from '@/screens/activity';
import JournalScreen from '@/screens/journal';
import SettingsScreen from '@/screens/settings';
import IntegrationsScreen from '@/screens/integrations';
import ImportScreen from '@/screens/import';
import PetScreen from '@/screens/pet';
import AchievementsScreen from '@/screens/achievements';

import type { RootStackParamList, AuthStackParamList, TabParamList } from './types';

const DarkTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#6366F1',
    background: '#0F172A',
    card: '#0F172A',
    text: '#F8FAFC',
    border: '#334155',
    notification: '#6366F1',
  },
};

const Tab = createBottomTabNavigator<TabParamList>();

function TabNavigator() {
  useNotifications();

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: { backgroundColor: '#1E293B', borderTopColor: '#334155' },
        tabBarActiveTintColor: '#6366F1',
        tabBarInactiveTintColor: '#94A3B8',
        headerStyle: { backgroundColor: '#0F172A' },
        headerTintColor: '#F8FAFC',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
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
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Дашборд',
          tabBarIcon: ({ color, size }) => (
            <Feather name="home" size={size} color={color} />
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
    </Tab.Navigator>
  );
}

const AuthStack = createNativeStackNavigator<AuthStackParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0F172A' },
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
  }, [loadStoredAuth, setOnboardingDone]);

  if (!isReady) {
    return <View style={{ flex: 1, backgroundColor: '#0F172A' }} />;
  }

  return (
    <NavigationContainer theme={DarkTheme}>
      <RootStack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0F172A' },
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
                headerStyle: { backgroundColor: '#0F172A' },
                headerTintColor: '#F8FAFC',
                headerTitleStyle: { fontWeight: '600' },
              }}
            />
            <RootStack.Screen
              name="Journal"
              component={JournalScreen}
              options={{
                headerShown: true,
                title: 'Дневник',
                headerStyle: { backgroundColor: '#0F172A' },
                headerTintColor: '#F8FAFC',
                headerTitleStyle: { fontWeight: '600' },
              }}
            />
            <RootStack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{
                headerShown: true,
                title: 'Настройки',
                headerStyle: { backgroundColor: '#0F172A' },
                headerTintColor: '#F8FAFC',
                headerTitleStyle: { fontWeight: '600' },
              }}
            />
            <RootStack.Screen
              name="Integrations"
              component={IntegrationsScreen}
              options={{
                headerShown: true,
                title: 'Интеграции',
                headerStyle: { backgroundColor: '#0F172A' },
                headerTintColor: '#F8FAFC',
                headerTitleStyle: { fontWeight: '600' },
              }}
            />
            <RootStack.Screen
              name="Import"
              component={ImportScreen}
              options={{
                headerShown: true,
                title: 'Импорт файлов',
                headerStyle: { backgroundColor: '#0F172A' },
                headerTintColor: '#F8FAFC',
                headerTitleStyle: { fontWeight: '600' },
              }}
            />
            <RootStack.Screen name="Pet" component={PetScreen} />
            <RootStack.Screen name="Achievements" component={AchievementsScreen} />
          </>
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
