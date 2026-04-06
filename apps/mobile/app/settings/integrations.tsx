import React, { useState, useEffect, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useIntegrationStore } from '@/stores/integration-store';
import { Card, Button } from '@/components/ui';
import { colors, spacing, fontSize } from '@/constants';
import {
  requestCalendarPermissions,
  getDeviceCalendars,
  importEventsFromCalendar,
} from '@/services/calendar-sync';
import { getHealthPermissions, syncStepsFromHealth, syncWeekSteps } from '@/services/health-sync';
import { exportCSV, exportPDFReport, exportStory, saveCSVToFile } from '@/services/export';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';

const discovery = AuthSession.useAutoDiscovery('https://accounts.google.com');

/* ───────── Section header ───────── */
interface SectionHeaderProps {
  title: string;
  icon: string;
}

const SectionHeader = memo(function SectionHeader({ title, icon }: SectionHeaderProps) {
  return (
    <Text style={styles.sectionTitle}>
      {icon}  {title}
    </Text>
  );
});

/* ───────── Status badge ───────── */
const ConnectedBadge = memo(function ConnectedBadge() {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>Подключён ✓</Text>
    </View>
  );
});

/* ───────── Google Calendar section ───────── */

function GoogleCalendarSection() {
  const { isConnected, connectGoogleCalendar, syncGoogleCalendar, disconnect, isLoading } =
    useIntegrationStore();
  const connected = isConnected('google-calendar');

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      redirectUri: AuthSession.makeRedirectUri(),
    },
    discovery,
  );

  useEffect(() => {
    if (response?.type === 'success' && response.authentication) {
      const { accessToken } = response.authentication;
      const refreshToken = response.authentication.refreshToken ?? '';
      connectGoogleCalendar(accessToken, refreshToken).catch(() => {
        Alert.alert('Ошибка', 'Не удалось подключить Google Calendar');
      });
    }
  }, [response, connectGoogleCalendar]);

  const handleConnect = useCallback(() => {
    if (!GOOGLE_CLIENT_ID) {
      Alert.alert('Ошибка', 'Google Client ID не настроен');
      return;
    }
    promptAsync();
  }, [promptAsync]);

  const handleSync = useCallback(async () => {
    try {
      await syncGoogleCalendar();
      Alert.alert('Готово', 'Календарь синхронизирован');
    } catch {
      Alert.alert('Ошибка', 'Не удалось синхронизировать');
    }
  }, [syncGoogleCalendar]);

  const handleDisconnect = useCallback(async () => {
    Alert.alert('Отключить Google Calendar?', 'События больше не будут синхронизироваться.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отключить',
        style: 'destructive',
        onPress: async () => {
          try {
            await disconnect('google-calendar');
          } catch {
            Alert.alert('Ошибка', 'Не удалось отключить');
          }
        },
      },
    ]);
  }, [disconnect]);

  return (
    <Card>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>📅  Google Calendar</Text>
        {connected && <ConnectedBadge />}
      </View>
      {connected ? (
        <View style={styles.cardActions}>
          <Button
            title="Синхронизировать"
            onPress={handleSync}
            variant="secondary"
            style={styles.actionButton}
          />
          <Button
            title="Отключить"
            onPress={handleDisconnect}
            variant="danger"
            style={styles.actionButton}
          />
        </View>
      ) : (
        <Button
          title="Подключить Google Calendar"
          onPress={handleConnect}
          disabled={!request || isLoading}
          style={styles.connectButton}
        />
      )}
    </Card>
  );
}

/* ───────── Apple Calendar section (iOS only) ───────── */

function AppleCalendarSection() {
  const [importing, setImporting] = useState(false);

  const handleSync = useCallback(async () => {
    const granted = await requestCalendarPermissions();
    if (!granted) {
      Alert.alert('Нет доступа', 'Разрешите доступ к календарю в настройках устройства');
      return;
    }

    const calendars = await getDeviceCalendars();
    if (calendars.length === 0) {
      Alert.alert('Пусто', 'Не найдено календарей на устройстве');
      return;
    }

    // Show calendar picker
    const calendarButtons = calendars.slice(0, 5).map((cal) => ({
      text: cal.title,
      onPress: async () => {
        setImporting(true);
        try {
          const now = new Date();
          const startDate = new Date(now);
          startDate.setDate(now.getDate() - 7);
          const endDate = new Date(now);
          endDate.setDate(now.getDate() + 30);

          const count = await importEventsFromCalendar(cal.id, startDate, endDate);
          Alert.alert('Готово', `Импортировано ${count} событий`);
        } catch {
          Alert.alert('Ошибка', 'Не удалось импортировать события');
        } finally {
          setImporting(false);
        }
      },
    }));

    Alert.alert('Выберите календарь', 'Откуда импортировать события?', [
      ...calendarButtons,
      { text: 'Отмена', style: 'cancel' },
    ]);
  }, []);

  if (Platform.OS !== 'ios') return null;

  return (
    <Card>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>🍎  Календарь устройства</Text>
      </View>
      <Text style={styles.cardDescription}>
        Импортируйте события из вашего календаря iOS
      </Text>
      {importing ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <Button
          title="Синхронизировать календарь устройства"
          onPress={handleSync}
          variant="secondary"
          style={styles.connectButton}
        />
      )}
    </Card>
  );
}

/* ───────── Health section ───────── */

function HealthSection() {
  const [syncing, setSyncing] = useState(false);

  const handleSyncSteps = useCallback(async () => {
    const available = await getHealthPermissions();
    if (!available) {
      Alert.alert('Недоступно', 'Педометр недоступен на этом устройстве');
      return;
    }

    setSyncing(true);
    try {
      const todaySteps = await syncStepsFromHealth(new Date());
      const weekResults = await syncWeekSteps();

      const weekTotal = weekResults.reduce((sum, d) => sum + d.steps, 0);
      Alert.alert(
        'Шаги синхронизированы',
        `Сегодня: ${todaySteps.toLocaleString()} шагов\nЗа неделю: ${weekTotal.toLocaleString()} шагов`,
      );
    } catch {
      Alert.alert('Ошибка', 'Не удалось синхронизировать шаги');
    } finally {
      setSyncing(false);
    }
  }, []);

  return (
    <Card>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>❤️  Здоровье</Text>
      </View>
      <Text style={styles.cardDescription}>
        Синхронизация шагов из {Platform.OS === 'ios' ? 'Apple Health' : 'Google Fit'}
      </Text>
      {syncing ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <Button
          title="Синхронизировать шаги"
          onPress={handleSyncSteps}
          variant="secondary"
          style={styles.connectButton}
        />
      )}
    </Card>
  );
}

/* ───────── Telegram section ───────── */

function TelegramSection() {
  const { isConnected, connectTelegram, disconnect, isLoading } = useIntegrationStore();
  const connected = isConnected('telegram');
  const [chatId, setChatId] = useState('');

  const handleConnect = useCallback(async () => {
    const trimmed = chatId.trim();
    if (!trimmed) {
      Alert.alert('Ошибка', 'Введите Chat ID');
      return;
    }

    try {
      await connectTelegram(trimmed);
      Alert.alert('Готово', 'Telegram подключён');
      setChatId('');
    } catch {
      Alert.alert('Ошибка', 'Не удалось подключить Telegram');
    }
  }, [chatId, connectTelegram]);

  const handleDisconnect = useCallback(async () => {
    Alert.alert('Отключить Telegram?', 'Уведомления больше не будут отправляться.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отключить',
        style: 'destructive',
        onPress: async () => {
          try {
            await disconnect('telegram');
          } catch {
            Alert.alert('Ошибка', 'Не удалось отключить');
          }
        },
      },
    ]);
  }, [disconnect]);

  return (
    <Card>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>✈️  Telegram</Text>
        {connected && <ConnectedBadge />}
      </View>
      {connected ? (
        <View style={styles.cardActions}>
          <Button
            title="Отключить"
            onPress={handleDisconnect}
            variant="danger"
            style={styles.actionButton}
          />
        </View>
      ) : (
        <>
          <Text style={styles.cardDescription}>
            Напишите @LifeOS_bot в Telegram, получите Chat ID и введите его здесь
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Chat ID"
            placeholderTextColor={colors.textSecondary}
            value={chatId}
            onChangeText={setChatId}
            keyboardType="number-pad"
            autoCorrect={false}
          />
          <Button
            title="Подключить"
            onPress={handleConnect}
            disabled={isLoading || !chatId.trim()}
            style={styles.connectButton}
          />
        </>
      )}
    </Card>
  );
}

/* ───────── Export section ───────── */

function ExportSection() {
  const [exporting, setExporting] = useState(false);

  const handleExportCSV = useCallback(async (module: 'finance' | 'habits' | 'tasks') => {
    const labels: Record<string, string> = {
      finance: 'Финансы',
      habits: 'Привычки',
      tasks: 'Задачи',
    };

    setExporting(true);
    try {
      const csv = await exportCSV(module);
      const filename = `lifeos_${module}_${new Date().toISOString().split('T')[0]}.csv`;
      const path = await saveCSVToFile(csv, filename);

      if (path) {
        Alert.alert('Экспорт готов', `Файл сохранён: ${filename}`);
      } else {
        Alert.alert('Готово', `${labels[module]} экспортированы`);
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось экспортировать данные');
    } finally {
      setExporting(false);
    }
  }, []);

  const handleMonthReport = useCallback(async () => {
    setExporting(true);
    try {
      await exportPDFReport('month');
      Alert.alert('Готово', 'Отчёт за месяц сформирован');
    } catch {
      Alert.alert('Ошибка', 'Не удалось сформировать отчёт');
    } finally {
      setExporting(false);
    }
  }, []);

  const handleStory = useCallback(async () => {
    setExporting(true);
    try {
      await exportStory();
      Alert.alert('Готово', 'Сторис сформирована');
    } catch {
      Alert.alert('Ошибка', 'Не удалось сформировать сторис');
    } finally {
      setExporting(false);
    }
  }, []);

  return (
    <Card>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>📤  Экспорт данных</Text>
      </View>
      {exporting ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <View style={styles.exportButtons}>
          <TouchableOpacity
            style={styles.exportRow}
            activeOpacity={0.7}
            onPress={() => handleExportCSV('finance')}
          >
            <Text style={styles.exportRowIcon}>💰</Text>
            <Text style={styles.exportRowLabel}>Экспорт финансов (CSV)</Text>
          </TouchableOpacity>

          <View style={styles.separator} />

          <TouchableOpacity
            style={styles.exportRow}
            activeOpacity={0.7}
            onPress={() => handleExportCSV('habits')}
          >
            <Text style={styles.exportRowIcon}>🏃</Text>
            <Text style={styles.exportRowLabel}>Экспорт привычек (CSV)</Text>
          </TouchableOpacity>

          <View style={styles.separator} />

          <TouchableOpacity
            style={styles.exportRow}
            activeOpacity={0.7}
            onPress={() => handleExportCSV('tasks')}
          >
            <Text style={styles.exportRowIcon}>📋</Text>
            <Text style={styles.exportRowLabel}>Экспорт задач (CSV)</Text>
          </TouchableOpacity>

          <View style={styles.separator} />

          <TouchableOpacity
            style={styles.exportRow}
            activeOpacity={0.7}
            onPress={handleMonthReport}
          >
            <Text style={styles.exportRowIcon}>📊</Text>
            <Text style={styles.exportRowLabel}>Отчёт за месяц</Text>
          </TouchableOpacity>

          <View style={styles.separator} />

          <TouchableOpacity
            style={styles.exportRow}
            activeOpacity={0.7}
            onPress={handleStory}
          >
            <Text style={styles.exportRowIcon}>📱</Text>
            <Text style={styles.exportRowLabel}>Поделиться в Stories</Text>
          </TouchableOpacity>
        </View>
      )}
    </Card>
  );
}

/* ───────── Main screen ───────── */

export default function IntegrationsScreen() {
  const router = useRouter();
  const { fetchIntegrations, isLoading } = useIntegrationStore();

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => router.back()}
        activeOpacity={0.7}
      >
        <Text style={styles.backText}>← Назад</Text>
      </TouchableOpacity>

      <Text style={styles.screenTitle}>Интеграции</Text>

      {isLoading && (
        <ActivityIndicator color={colors.primary} style={styles.topLoader} />
      )}

      <SectionHeader title="Календари" icon="📅" />
      <GoogleCalendarSection />
      <AppleCalendarSection />

      <SectionHeader title="Здоровье" icon="❤️" />
      <HealthSection />

      <SectionHeader title="Мессенджеры" icon="💬" />
      <TelegramSection />

      <SectionHeader title="Экспорт" icon="📤" />
      <ExportSection />
    </ScrollView>
  );
}

/* ───────── Styles ───────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingTop: spacing.xl + 32,
    paddingBottom: spacing.xl,
  },
  backButton: {
    marginBottom: spacing.sm,
  },
  backText: {
    fontSize: fontSize.md,
    color: colors.primary,
  },
  screenTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  topLoader: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  cardDescription: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  connectButton: {
    marginTop: spacing.xs,
  },
  badge: {
    backgroundColor: colors.success + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: fontSize.xs,
    color: colors.success,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  loader: {
    marginVertical: spacing.md,
  },
  exportButtons: {
    marginTop: spacing.xs,
  },
  exportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  exportRowIcon: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  exportRowLabel: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
});
