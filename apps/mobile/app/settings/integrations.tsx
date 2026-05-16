import React, { useState, useEffect, useCallback, memo , useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
  TextInput,
  Share,
  Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { useIntegrationStore } from '@/stores/integration-store';
import { Card, Button, SectionHeader } from '@/components/ui';
import { spacing, fontSize } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { useCalendarSync } from '@/hooks/use-calendar-sync';
import { AnimatedPress } from '@/components/ui/animated-press';
import { FadeInView } from '@/components/ui/fade-in-view';
import { getHealthPermissions, syncStepsFromHealth, syncWeekSteps } from '@/services/health-sync';
import {
  requestPermissions as requestHealthPermissions,
  syncHealthData,
  syncWeekSteps as syncWeekHealthSteps,
  isHealthSyncEnabled,
  setHealthSyncEnabled,
  getLastSyncTime,
  getCachedMetrics,
  getHealthProviderName,
} from '@/services/health-connect';
import { useHealthSync } from '@/hooks/use-health-sync';
import { exportCSV, exportPDFReport, exportStory, saveCSVToFile } from '@/services/export';

WebBrowser.maybeCompleteAuthSession();

/* ───────── Integration group header ───────── */
interface IntegrationGroupHeaderProps {
  title: string;
  icon: string;
}

const IntegrationGroupHeader = memo(function IntegrationGroupHeader({
  title,
  icon,
}: IntegrationGroupHeaderProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <Text style={styles.sectionTitle}>
      {icon}  {title}
    </Text>
  );
});

/* ───────── Status badge ───────── */
const ConnectedBadge = memo(function ConnectedBadge() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>Подключён ✓</Text>
    </View>
  );
});

/* ───────── Google Calendar section ───────── */

function GoogleCalendarSection() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const {
    isConnected,
    getGoogleAuthUrl,
    syncGoogleCalendar,
    disconnect,
    fetchIntegrations,
    isLoading,
  } = useIntegrationStore();
  const connected = isConnected('google-calendar');

  // Phase 3.1: серверный OAuth-redirect. Web-клиент Google не принимает
  // кастомную схему мобилки (lifeos://), а Expo-прокси в SDK54 удалён.
  // Поэтому: просим у сервера auth-url → открываем системный браузер →
  // Google редиректит на наш /callback → сервер меняет code на токены
  // своим client_secret (он наружу не выходит) и deep-link'ом
  // (lifeos://settings/integrations) возвращает в приложение.
  const handleConnect = useCallback(async () => {
    try {
      const url = await getGoogleAuthUrl();
      if (!url) {
        Alert.alert('Google Calendar', 'Сервер не вернул ссылку авторизации. Попробуй позже.');
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(
        url,
        'lifeos://settings/integrations',
      );
      // Сервер уже сохранил токены к моменту deep-link'а — просто
      // перечитываем список интеграций, чтобы UI показал «подключено».
      if (result.type === 'success' || result.type === 'dismiss') {
        await fetchIntegrations();
        if (useIntegrationStore.getState().isConnected('google-calendar')) {
          Alert.alert('Готово', 'Google Calendar подключён');
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes('503')
          ? 'Google Calendar ещё не настроен на сервере'
          : 'Не удалось начать авторизацию Google';
      Alert.alert('Ошибка', msg);
    }
  }, [getGoogleAuthUrl, fetchIntegrations]);

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
          disabled={isLoading}
          style={styles.connectButton}
        />
      )}
    </Card>
  );
}

/* ───────── Device Calendar section (iOS + Android) ───────── */

function DeviceCalendarSection() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const calStyles = useMemo(() => createCalendarStyles(c), [c]);
  const {
    isSyncing,
    lastSync,
    syncNow,
    calendars,
    selectedCalendar,
    setSelectedCalendar,
    syncEnabled,
    setSyncEnabled,
    syncedEventCount,
    loadCalendars,
  } = useCalendarSync();
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (syncEnabled) {
      loadCalendars();
    }
  }, [syncEnabled, loadCalendars]);

  const providerName =
    Platform.OS === 'ios' ? 'Apple Calendar' : 'Google Calendar';
  const providerIcon = Platform.OS === 'ios' ? '🍎' : '📅';

  const selectedCalName = calendars.find(
    (cal) => cal.id === selectedCalendar,
  )?.title;

  const formatLastSync = (iso: string | null): string => {
    if (!iso) return 'никогда';
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return `${diffMin} мин назад`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH} ч назад`;
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleToggle = useCallback(async () => {
    await setSyncEnabled(!syncEnabled);
    if (!syncEnabled) {
      await loadCalendars();
    }
  }, [syncEnabled, setSyncEnabled, loadCalendars]);

  const handleSelectCalendar = useCallback(
    (calId: string) => {
      setSelectedCalendar(calId);
      setShowPicker(false);
    },
    [setSelectedCalendar],
  );

  return (
    <Card>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          {providerIcon}  {providerName}
        </Text>
        {syncEnabled && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Активно ✓</Text>
          </View>
        )}
      </View>

      <Text style={styles.cardDescription}>
        Двусторонняя синхронизация событий с календарём устройства
      </Text>

      {/* Enable/disable toggle */}
      <AnimatedPress
        style={calStyles.toggleRow}
        onPress={handleToggle}
      >
        <Text style={calStyles.toggleLabel}>Автосинхронизация</Text>
        <View
          style={[
            calStyles.toggleTrack,
            syncEnabled && calStyles.toggleTrackOn,
          ]}
        >
          <View
            style={[
              calStyles.toggleThumb,
              syncEnabled && calStyles.toggleThumbOn,
            ]}
          />
        </View>
      </AnimatedPress>

      {syncEnabled && (
        <>
          {/* Calendar picker */}
          <AnimatedPress
            style={calStyles.pickerButton}
            onPress={() => setShowPicker(!showPicker)}
          >
            <Text style={calStyles.pickerLabel}>Календарь</Text>
            <Text style={calStyles.pickerValue}>
              {selectedCalName ?? 'Все календари'} {'\u25BE'}
            </Text>
          </AnimatedPress>

          {showPicker && calendars.length > 0 && (
            <View style={calStyles.pickerList}>
              <AnimatedPress
                style={calStyles.pickerItem}
                onPress={() => {
                  setSelectedCalendar('');
                  setShowPicker(false);
                }}
              >
                <Text
                  style={[
                    calStyles.pickerItemText,
                    !selectedCalendar && calStyles.pickerItemActive,
                  ]}
                >
                  Все календари
                </Text>
              </AnimatedPress>
              {calendars.map((cal) => (
                <AnimatedPress
                  key={cal.id}
                  style={calStyles.pickerItem}
                  onPress={() => handleSelectCalendar(cal.id)}
                >
                  <View
                    style={[
                      calStyles.calendarDot,
                      { backgroundColor: cal.color },
                    ]}
                  />
                  <Text
                    style={[
                      calStyles.pickerItemText,
                      selectedCalendar === cal.id &&
                        calStyles.pickerItemActive,
                    ]}
                    numberOfLines={1}
                  >
                    {cal.title}
                  </Text>
                  <Text style={calStyles.calendarSource}>{cal.source}</Text>
                </AnimatedPress>
              ))}
            </View>
          )}

          {/* Stats row */}
          <View style={calStyles.statsRow}>
            <View style={calStyles.statItem}>
              <Text style={calStyles.statValue}>{syncedEventCount}</Text>
              <Text style={calStyles.statLabel}>событий</Text>
            </View>
            <View style={calStyles.statItem}>
              <Text style={calStyles.statValue}>
                {formatLastSync(lastSync)}
              </Text>
              <Text style={calStyles.statLabel}>посл. синхр.</Text>
            </View>
          </View>

          {/* Manual sync button */}
          {isSyncing ? (
            <ActivityIndicator color={c.primary} style={styles.loader} />
          ) : (
            <Button
              title="Синхронизировать сейчас"
              onPress={syncNow}
              variant="secondary"
              style={styles.connectButton}
            />
          )}
        </>
      )}
    </Card>
  );
}

function createCalendarStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      marginBottom: spacing.sm,
    },
    toggleLabel: {
      fontSize: fontSize.md,
      color: c.text,
    },
    toggleTrack: {
      width: 48,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.border,
      justifyContent: 'center',
      paddingHorizontal: 2,
    },
    toggleTrackOn: {
      backgroundColor: c.primary,
    },
    toggleThumb: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: '#fff',
    },
    toggleThumbOn: {
      alignSelf: 'flex-end',
    },
    pickerButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    pickerLabel: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
    },
    pickerValue: {
      fontSize: fontSize.sm,
      color: c.text,
      fontWeight: '500',
    },
    pickerList: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      marginBottom: spacing.sm,
      overflow: 'hidden',
    },
    pickerItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    pickerItemText: {
      fontSize: fontSize.sm,
      color: c.text,
      flex: 1,
    },
    pickerItemActive: {
      color: c.primary,
      fontWeight: '600',
    },
    calendarDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      marginRight: spacing.sm,
    },
    calendarSource: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      marginLeft: spacing.sm,
    },
    statsRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingVertical: spacing.md,
      marginBottom: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: 12,
    },
    statItem: {
      alignItems: 'center',
    },
    statValue: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.text,
    },
    statLabel: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      marginTop: 2,
    },
  });
}

/* ───────── Health section ───────── */

function HealthSection() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const healthStyles = useMemo(() => createHealthStyles(c), [c]);
  const [enabled, setEnabled] = useState(isHealthSyncEnabled);
  const { metrics, isSyncing, syncNow, lastError } = useHealthSync();

  const providerName = getHealthProviderName();

  const handleToggle = useCallback(async () => {
    if (!enabled) {
      // Включаем — запрашиваем разрешения
      const granted = await requestHealthPermissions();
      if (!granted) {
        Alert.alert(
          'Нет доступа',
          `Разрешите доступ к ${providerName} в настройках устройства`,
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Открыть настройки', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
      setHealthSyncEnabled(true);
      setEnabled(true);
      syncNow();
    } else {
      // Выключаем
      setHealthSyncEnabled(false);
      setEnabled(false);
    }
  }, [enabled, providerName, syncNow]);

  const handleManualSync = useCallback(async () => {
    const granted = await requestHealthPermissions();
    if (!granted) {
      Alert.alert(
        'Педометр недоступен',
        'Разрешите доступ к здоровью в настройках устройства',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Открыть настройки', onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }

    try {
      await syncNow();

      // Также синхронизируем шаги за неделю
      const weekResults = await syncWeekHealthSteps();
      const weekTotal = weekResults.reduce((sum, d) => sum + d.steps, 0);

      Alert.alert(
        'Данные синхронизированы',
        `Сегодня: ${metrics.steps.toLocaleString()} шагов\nЗа неделю: ${weekTotal.toLocaleString()} шагов`,
      );
    } catch {
      Alert.alert('Ошибка', 'Не удалось синхронизировать данные');
    }
  }, [syncNow, metrics.steps]);

  const formatLastSync = useCallback((isoStr: string | null): string => {
    if (!isoStr) return 'никогда';
    const date = new Date(isoStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);

    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return `${diffMin} мин. назад`;

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} ч. назад`;

    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }, []);

  return (
    <Card>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          {Platform.OS === 'ios' ? '🍎' : '💚'}  {providerName}
        </Text>
        {enabled && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Вкл</Text>
          </View>
        )}
      </View>

      <Text style={styles.cardDescription}>
        Автоматическая синхронизация шагов, сна и пульса из {providerName}.
        {'\n'}Данные обновляются каждые 15 минут.
      </Text>

      {/* Переключатель */}
      <AnimatedPress
        style={healthStyles.toggleRow}
        onPress={handleToggle}
      >
        <Text style={healthStyles.toggleLabel}>
          {enabled ? 'Синхронизация включена' : 'Включить синхронизацию'}
        </Text>
        <View style={[healthStyles.toggle, enabled && healthStyles.toggleActive]}>
          <View style={[healthStyles.toggleThumb, enabled && healthStyles.toggleThumbActive]} />
        </View>
      </AnimatedPress>

      {enabled && (
        <>
          {/* Метрики */}
          <View style={healthStyles.metricsGrid}>
            <View style={healthStyles.metricCard}>
              <Text style={healthStyles.metricIcon}>👟</Text>
              <Text style={healthStyles.metricValue}>
                {metrics.steps.toLocaleString()}
              </Text>
              <Text style={healthStyles.metricLabel}>Шаги</Text>
            </View>

            <View style={healthStyles.metricCard}>
              <Text style={healthStyles.metricIcon}>😴</Text>
              <Text style={healthStyles.metricValue}>
                {metrics.sleepHours !== null ? `${metrics.sleepHours.toFixed(1)} ч` : '—'}
              </Text>
              <Text style={healthStyles.metricLabel}>Сон</Text>
            </View>

            <View style={healthStyles.metricCard}>
              <Text style={healthStyles.metricIcon}>❤️</Text>
              <Text style={healthStyles.metricValue}>
                {metrics.heartRate !== null ? `${metrics.heartRate}` : '—'}
              </Text>
              <Text style={healthStyles.metricLabel}>Пульс</Text>
            </View>

            <View style={healthStyles.metricCard}>
              <Text style={healthStyles.metricIcon}>🔥</Text>
              <Text style={healthStyles.metricValue}>
                {metrics.activeCalories !== null ? `${metrics.activeCalories}` : '—'}
              </Text>
              <Text style={healthStyles.metricLabel}>Калории</Text>
            </View>
          </View>

          {/* Последняя синхронизация */}
          <Text style={healthStyles.lastSyncText}>
            Последняя синхронизация: {formatLastSync(metrics.lastSyncAt)}
          </Text>

          {lastError && (
            <Text style={healthStyles.errorText}>{lastError}</Text>
          )}

          {/* Кнопка ручной синхронизации */}
          {isSyncing ? (
            <ActivityIndicator color={c.primary} style={styles.loader} />
          ) : (
            <Button
              title="Синхронизировать сейчас"
              onPress={handleManualSync}
              variant="secondary"
              style={styles.connectButton}
            />
          )}
        </>
      )}
    </Card>
  );
}

function createHealthStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      marginBottom: spacing.sm,
    },
    toggleLabel: {
      fontSize: fontSize.md,
      color: c.text,
      fontWeight: '500',
    },
    toggle: {
      width: 50,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.surfaceLight,
      justifyContent: 'center',
      paddingHorizontal: 2,
    },
    toggleActive: {
      backgroundColor: c.success,
    },
    toggleThumb: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: c.text,
    },
    toggleThumbActive: {
      alignSelf: 'flex-end',
    },
    metricsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginVertical: spacing.sm,
    },
    metricCard: {
      flex: 1,
      minWidth: 130,
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: spacing.sm,
      alignItems: 'center',
    },
    metricIcon: {
      fontSize: 24,
      marginBottom: spacing.xs,
    },
    metricValue: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.text,
    },
    metricLabel: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      marginTop: 2,
    },
    lastSyncText: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      textAlign: 'center',
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
    },
    errorText: {
      fontSize: fontSize.xs,
      color: c.danger,
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
  });
}

/* ───────── Telegram section ───────── */

function TelegramSection() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
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
            1. Откройте Telegram и найдите @LifeOS_bot{'\n'}
            2. Нажмите /start — бот пришлёт ваш Chat ID{'\n'}
            3. Вставьте его ниже
          </Text>
          <AnimatedPress
            onPress={() => Linking.openURL('https://t.me/LifeOS_bot')}
          >
            <Text style={[styles.cardDescription, { color: c.primary, fontWeight: '600' }]}>
              Открыть @LifeOS_bot в Telegram {'\u2192'}
            </Text>
          </AnimatedPress>
          <TextInput
            style={styles.input}
            placeholder="Вставьте Chat ID"
            placeholderTextColor={c.textSecondary}
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
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
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
      const story = await exportStory();
      // Open native share sheet: user picks Instagram / Telegram / WhatsApp.
      const shareMessage = story.text
        ? story.text
        : 'Мой прогресс в LifeOS 🎯';

      const result = await Share.share(
        {
          title: 'LifeOS — мой прогресс',
          message: shareMessage,
          ...(story.imageUrl ? { url: story.imageUrl } : {}),
        },
        {
          dialogTitle: 'Поделиться прогрессом',
          subject: 'LifeOS Stories',
        },
      );

      if (result.action === Share.dismissedAction) {
        // User cancelled — no-op.
        return;
      }

      // Offer direct Instagram Stories deep link (iOS only, and only if app installed).
      if (Platform.OS === 'ios') {
        const canOpenIG = await Linking.canOpenURL('instagram-stories://share');
        if (canOpenIG) {
          Alert.alert(
            'Открыть в Instagram Stories?',
            'Вставить текст прямо в сторис Instagram?',
            [
              { text: 'Нет', style: 'cancel' },
              {
                text: 'Открыть',
                onPress: () => Linking.openURL('instagram-stories://share'),
              },
            ],
          );
        }
      }
    } catch (err) {
      console.error('Share story error:', err);
      Alert.alert('Ошибка', 'Не удалось поделиться');
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
        <ActivityIndicator color={c.primary} style={styles.loader} />
      ) : (
        <View style={styles.exportButtons}>
          <AnimatedPress
            style={styles.exportRow}
            onPress={() => handleExportCSV('finance')}
          >
            <Text style={styles.exportRowIcon}>💰</Text>
            <Text style={styles.exportRowLabel}>Экспорт финансов (CSV)</Text>
          </AnimatedPress>

          <View style={styles.separator} />

          <AnimatedPress
            style={styles.exportRow}
            onPress={() => handleExportCSV('habits')}
          >
            <Text style={styles.exportRowIcon}>🏃</Text>
            <Text style={styles.exportRowLabel}>Экспорт привычек (CSV)</Text>
          </AnimatedPress>

          <View style={styles.separator} />

          <AnimatedPress
            style={styles.exportRow}
            onPress={() => handleExportCSV('tasks')}
          >
            <Text style={styles.exportRowIcon}>📋</Text>
            <Text style={styles.exportRowLabel}>Экспорт задач (CSV)</Text>
          </AnimatedPress>

          <View style={styles.separator} />

          <AnimatedPress
            style={styles.exportRow}
            onPress={handleMonthReport}
          >
            <Text style={styles.exportRowIcon}>📊</Text>
            <Text style={styles.exportRowLabel}>Отчёт за месяц</Text>
          </AnimatedPress>

          <View style={styles.separator} />

          <AnimatedPress
            style={styles.exportRow}
            onPress={handleStory}
          >
            <Text style={styles.exportRowIcon}>📱</Text>
            <Text style={styles.exportRowLabel}>Поделиться в Stories</Text>
          </AnimatedPress>
        </View>
      )}
    </Card>
  );
}

/* ───────── Main screen ───────── */

export default function IntegrationsScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
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
      <AnimatedPress
        style={styles.backButton}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.backText}>{'\u2190'} Назад</Text>
      </AnimatedPress>

      <FadeInView delay={0}>
        <SectionHeader title="Интеграции" subtitle="Подключения и экспорт данных" />
      </FadeInView>

      {isLoading && (
        <ActivityIndicator color={c.primary} style={styles.topLoader} />
      )}

      <FadeInView delay={80}>
        <IntegrationGroupHeader title="Календари" icon="📅" />
        <GoogleCalendarSection />
      </FadeInView>

      <FadeInView delay={160}>
        <DeviceCalendarSection />
      </FadeInView>

      <FadeInView delay={240}>
        <IntegrationGroupHeader title="Здоровье" icon="❤️" />
        <HealthSection />
      </FadeInView>

      <FadeInView delay={320}>
        <IntegrationGroupHeader title="Мессенджеры" icon="💬" />
        <TelegramSection />
      </FadeInView>

      <FadeInView delay={400}>
        <IntegrationGroupHeader title="Экспорт" icon="📤" />
        <ExportSection />
      </FadeInView>
    </ScrollView>
  );
}

/* ───────── Styles ───────── */

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
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
    color: c.primary,
  },
  topLoader: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: c.textSecondary,
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
    color: c.text,
  },
  cardDescription: {
    fontSize: fontSize.sm,
    color: c.textSecondary,
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
    backgroundColor: c.success + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: fontSize.xs,
    color: c.success,
    fontWeight: '600',
  },
  input: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: c.text,
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
    color: c.text,
  },
  separator: {
    height: 1,
    backgroundColor: c.border,
    marginVertical: spacing.xs,
  },
  });
}
