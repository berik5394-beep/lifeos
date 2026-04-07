import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { storage } from '@/services/storage';
import { useAuthStore } from '@/stores/auth-store';
import { useThemeStore } from '@/stores/theme-store';
import { Card, Button } from '@/components/ui';
import { colors, spacing, fontSize, borderRadius } from '@/constants';
import {
  scheduleWakeUpNotification,
  cancelWakeUpNotification,
} from '@/services/wake-up-notification';

const ASSISTANT_STYLES = [
  { key: 'friendly', label: 'Дружелюбный', icon: '😊' },
  { key: 'strict', label: 'Строгий тренер', icon: '💪' },
  { key: 'calm', label: 'Спокойный наставник', icon: '🧘' },
  { key: 'toxic', label: 'Токсичный мотиватор', icon: '🔥' },
] as const;

type AssistantStyleKey = (typeof ASSISTANT_STYLES)[number]['key'];

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
  const [assistantStyle, setAssistantStyle] = useState<AssistantStyleKey>(() => {
    const stored = storage.getString('assistantStyle');
    return (stored as AssistantStyleKey) ?? 'friendly';
  });
  const [assistantGender, setAssistantGender] = useState<'female' | 'male'>(() => {
    const stored = storage.getString('assistantGender');
    return (stored as 'female' | 'male') ?? 'female';
  });
  const [wakeUpTime, setWakeUpTime] = useState(() => {
    return storage.getString('wakeUpTime') ?? '07:00';
  });
  const [editingWakeUpTime, setEditingWakeUpTime] = useState(false);
  const [wakeUpTimeInput, setWakeUpTimeInput] = useState('');

  const handleToggleMorning = useCallback(() => {
    const next = !morningReminder;
    setMorningReminder(next);
    storage.setBoolean('morning_reminder', next);
  }, [morningReminder]);

  const handleToggleEvening = useCallback(() => {
    const next = !eveningReview;
    setEveningReview(next);
    storage.setBoolean('evening_review', next);
  }, [eveningReview]);

  const handleToggleTasks = useCallback(() => {
    const next = !taskReminders;
    setTaskReminders(next);
    storage.setBoolean('task_reminders', next);
  }, [taskReminders]);

  const handleAssistantStyleChange = useCallback((key: AssistantStyleKey) => {
    if (key === 'toxic') {
      Alert.alert(
        'Внимание',
        'Этот ассистент будет грубым и саркастичным. Это мотивационный стиль — не принимайте близко к сердцу.',
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Понятно',
            onPress: () => {
              setAssistantStyle(key);
              storage.set('assistantStyle', key);
            },
          },
        ],
      );
    } else {
      setAssistantStyle(key);
      storage.set('assistantStyle', key);
    }
  }, []);

  const handleGenderChange = useCallback((gender: 'female' | 'male') => {
    setAssistantGender(gender);
    storage.set('assistantGender', gender);
  }, []);

  const handleWakeUpTimeEdit = useCallback(() => {
    setWakeUpTimeInput(wakeUpTime);
    setEditingWakeUpTime(true);
  }, [wakeUpTime]);

  const handleWakeUpTimeSave = useCallback(() => {
    const trimmed = wakeUpTimeInput.trim();
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
    if (!match) {
      Alert.alert('Ошибка', 'Введите время в формате ЧЧ:ММ (например, 07:00)');
      return;
    }
    setWakeUpTime(trimmed);
    storage.set('wakeUpTime', trimmed);
    setEditingWakeUpTime(false);
    scheduleWakeUpNotification(trimmed);
  }, [wakeUpTimeInput]);

  const handleImport = useCallback(() => {
    router.push('/import');
  }, [router]);

  const handleExport = useCallback(() => {
    Alert.alert('Экспорт данных', 'Скоро!');
  }, []);

  const handleIntegrations = useCallback(() => {
    router.push('/settings/integrations');
  }, [router]);

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

      {/* Ассистент */}
      <Text style={styles.sectionTitle}>Ассистент</Text>
      <Card>
        {ASSISTANT_STYLES.map((style, index) => (
          <View key={style.key}>
            {index > 0 && <View style={styles.separator} />}
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => handleAssistantStyleChange(style.key)}
            >
              <View style={styles.rowLeft}>
                <Text style={styles.rowIcon}>{style.icon}</Text>
                <Text style={styles.rowLabel}>{style.label}</Text>
              </View>
              <View
                style={[
                  styles.radio,
                  assistantStyle === style.key && styles.radioSelected,
                ]}
              >
                {assistantStyle === style.key && (
                  <View style={styles.radioInner} />
                )}
              </View>
            </TouchableOpacity>
          </View>
        ))}
      </Card>

      {/* Голос ассистента */}
      <Card>
        <Text style={styles.settingLabel}>Голос ассистента</Text>
        <View style={styles.genderRow}>
          <TouchableOpacity
            style={[
              styles.genderOption,
              assistantGender === 'female' && styles.genderOptionSelected,
            ]}
            onPress={() => handleGenderChange('female')}
            activeOpacity={0.7}
          >
            <Text style={styles.genderOptionText}>Женский</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.genderOption,
              assistantGender === 'male' && styles.genderOptionSelected,
            ]}
            onPress={() => handleGenderChange('male')}
            activeOpacity={0.7}
          >
            <Text style={styles.genderOptionText}>Мужской</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.separator} />
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.7}
          onPress={handleWakeUpTimeEdit}
        >
          <View style={styles.rowLeft}>
            <Text style={styles.rowIcon}>{'\u23F0'}</Text>
            <Text style={styles.rowLabel}>Время пробуждения</Text>
          </View>
          <Text style={styles.rowValue}>{wakeUpTime}</Text>
        </TouchableOpacity>
        {editingWakeUpTime && (
          <View style={styles.wakeUpEditRow}>
            <TextInput
              style={styles.wakeUpInput}
              value={wakeUpTimeInput}
              onChangeText={setWakeUpTimeInput}
              placeholder="ЧЧ:ММ"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              autoFocus
              onSubmitEditing={handleWakeUpTimeSave}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={styles.wakeUpSaveButton}
              onPress={handleWakeUpTimeSave}
            >
              <Text style={styles.wakeUpSaveText}>Сохранить</Text>
            </TouchableOpacity>
          </View>
        )}
      </Card>

      {/* Данные */}
      <Text style={styles.sectionTitle}>Данные</Text>
      <Card>
        <SettingRow icon="📥" label="Импорт файлов" onPress={handleImport} />
        <View style={styles.separator} />
        <SettingRow icon="📤" label="Экспорт данных" onPress={handleExport} />
        <View style={styles.separator} />
        <SettingRow icon="🔗" label="Интеграции" onPress={handleIntegrations} />
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
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  settingLabel: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  genderRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  genderOption: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  genderOptionSelected: {
    borderColor: colors.primary,
  },
  genderOptionText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  wakeUpEditRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  wakeUpInput: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: fontSize.md,
  },
  wakeUpSaveButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  wakeUpSaveText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
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
