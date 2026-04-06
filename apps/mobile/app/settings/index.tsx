import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { createMMKV } from 'react-native-mmkv';
import { useAuthStore } from '@/stores/auth-store';
import { useThemeStore } from '@/stores/theme-store';
import { Card, Button } from '@/components/ui';
import { colors, spacing, fontSize } from '@/constants';

const storage = createMMKV({ id: 'settings-storage' });

function loadToggle(key: string, fallback: boolean): boolean {
  const stored = storage.getBoolean(key);
  return stored ?? fallback;
}

interface SettingRowProps {
  icon: string;
  label: string;
  value?: string;
  isToggle?: boolean;
  toggleValue?: boolean;
  onPress?: () => void;
}

function SettingRow({
  icon,
  label,
  value,
  isToggle,
  toggleValue,
  onPress,
}: SettingRowProps) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.rowIcon}>{icon}</Text>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      {isToggle != null && isToggle ? (
        <View
          style={[
            styles.toggle,
            toggleValue ? styles.toggleOn : styles.toggleOff,
          ]}
        >
          <View
            style={[
              styles.toggleThumb,
              toggleValue ? styles.toggleThumbOn : styles.toggleThumbOff,
            ]}
          />
        </View>
      ) : value ? (
        <Text style={styles.rowValue}>{value}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { themeName, toggleTheme } = useThemeStore();

  const [morningReminder, setMorningReminder] = useState(() =>
    loadToggle('morning_reminder', true),
  );
  const [eveningReview, setEveningReview] = useState(() =>
    loadToggle('evening_review', true),
  );
  const [taskReminders, setTaskReminders] = useState(() =>
    loadToggle('task_reminders', true),
  );

  const handleToggleMorning = useCallback(() => {
    const next = !morningReminder;
    setMorningReminder(next);
    storage.set('morning_reminder', next);
  }, [morningReminder]);

  const handleToggleEvening = useCallback(() => {
    const next = !eveningReview;
    setEveningReview(next);
    storage.set('evening_review', next);
  }, [eveningReview]);

  const handleToggleTasks = useCallback(() => {
    const next = !taskReminders;
    setTaskReminders(next);
    storage.set('task_reminders', next);
  }, [taskReminders]);

  const handleExport = useCallback(() => {
    Alert.alert('Экспорт данных', 'Скоро!');
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert('Выход', 'Вы уверены, что хотите выйти?', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Выйти',
        style: 'destructive',
        onPress: () => {
          logout();
          router.replace('/');
        },
      },
    ]);
  }, [logout, router]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.screenTitle}>Настройки</Text>

      {/* Профиль */}
      <Text style={styles.sectionTitle}>Профиль</Text>
      <Card>
        <SettingRow icon="👤" label="Имя" value={user?.name ?? '—'} />
        <View style={styles.separator} />
        <SettingRow icon="📧" label="Почта" value={user?.email ?? '—'} />
      </Card>

      {/* Оформление */}
      <Text style={styles.sectionTitle}>Оформление</Text>
      <Card>
        <SettingRow
          icon="🌙"
          label={themeName === 'dark' ? 'Тёмная тема' : 'Светлая тема'}
          isToggle
          toggleValue={themeName === 'dark'}
          onPress={toggleTheme}
        />
      </Card>

      {/* Уведомления */}
      <Text style={styles.sectionTitle}>Уведомления</Text>
      <Card>
        <SettingRow
          icon="🌅"
          label="Утреннее напоминание"
          isToggle
          toggleValue={morningReminder}
          onPress={handleToggleMorning}
        />
        <View style={styles.separator} />
        <SettingRow
          icon="🌙"
          label="Вечерний обзор"
          isToggle
          toggleValue={eveningReview}
          onPress={handleToggleEvening}
        />
        <View style={styles.separator} />
        <SettingRow
          icon="🔔"
          label="Напоминания о задачах"
          isToggle
          toggleValue={taskReminders}
          onPress={handleToggleTasks}
        />
      </Card>

      {/* Данные */}
      <Text style={styles.sectionTitle}>Данные</Text>
      <Card>
        <SettingRow icon="📤" label="Экспорт данных" onPress={handleExport} />
      </Card>

      {/* Аккаунт */}
      <Text style={styles.sectionTitle}>Аккаунт</Text>
      <Card style={styles.dangerCard}>
        <Button
          title="Выйти из аккаунта"
          onPress={handleLogout}
          variant="danger"
          style={styles.logoutButton}
        />
      </Card>

      <Text style={styles.version}>LifeOS v1.0.0</Text>
    </ScrollView>
  );
}

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
  screenTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  rowIcon: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  rowLabel: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  rowValue: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    maxWidth: 180,
    textAlign: 'right',
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleOn: {
    backgroundColor: colors.primary,
  },
  toggleOff: {
    backgroundColor: colors.surfaceLight,
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.text,
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },
  toggleThumbOff: {
    alignSelf: 'flex-start',
  },
  dangerCard: {
    borderColor: colors.danger,
  },
  logoutButton: {
    width: '100%',
  },
  version: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
