import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ScrollView,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { storage } from '@/services/storage';
import { exportCSV, saveCSVToFile } from '@/services/export';
import { useAuthStore } from '@/stores/auth-store';
import { useThemeStore } from '@/stores/theme-store';
import { themeLabels, themeIcons, type ThemeName } from '@/constants/themes';
import { Card, Button, SectionHeader } from '@/components/ui';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { useUIStore, type UIComplexity } from '@/stores/ui-store';
import { AnimatedPress } from '@/components/ui/animated-press';
import { FadeInView } from '@/components/ui/fade-in-view';

const THEME_OPTIONS: ThemeName[] = ['dark', 'planner', 'pink'];
import {
  scheduleWakeUpNotification,
  cancelWakeUpNotification,
} from '@/services/wake-up-notification';

const UI_COMPLEXITY_OPTIONS: { key: UIComplexity; label: string; icon: string; desc: string }[] = [
  { key: 'simple', label: 'Простой', icon: '🌱', desc: 'Задачи и привычки' },
  { key: 'standard', label: 'Стандарт', icon: '⚡', desc: '+ Финансы, цели, теги' },
  { key: 'power', label: 'Продвинутый', icon: '🚀', desc: '+ Kanban, Gantt, зависимости' },
];

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
      color: c.text,
    },
    rowValue: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      maxWidth: 180,
      textAlign: 'right',
    },
    separator: {
      height: 1,
      backgroundColor: c.border,
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
      backgroundColor: c.primary,
    },
    toggleOff: {
      backgroundColor: c.surfaceLight,
    },
    toggleThumb: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: c.text,
    },
    toggleThumbOn: {
      alignSelf: 'flex-end' as const,
    },
    toggleThumbOff: {
      alignSelf: 'flex-start' as const,
    },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: c.surfaceLight,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    radioSelected: {
      borderColor: c.primary,
    },
    radioInner: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: c.primary,
    },
    settingLabel: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '600',
      marginBottom: spacing.sm,
    },
    genderRow: {
      flexDirection: 'row' as const,
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    genderOption: {
      flex: 1,
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      alignItems: 'center' as const,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    genderOptionSelected: {
      borderColor: c.primary,
    },
    genderOptionText: {
      color: c.text,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    wakeUpEditRow: {
      flexDirection: 'row' as const,
      gap: spacing.sm,
      marginTop: spacing.sm,
      alignItems: 'center' as const,
    },
    wakeUpInput: {
      flex: 1,
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      color: c.text,
      fontSize: fontSize.md,
    },
    wakeUpSaveButton: {
      backgroundColor: c.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    wakeUpSaveText: {
      color: c.text,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    passwordChangeContainer: {
      paddingTop: spacing.sm,
      gap: spacing.sm,
    },
    passwordInput: {
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      color: c.text,
      fontSize: fontSize.md,
    },
    dangerCard: {
      borderColor: c.danger,
    },
    logoutButton: {
      width: '100%' as const,
    },
    deleteAccountButton: {
      alignItems: 'center' as const,
      paddingVertical: spacing.md,
      marginTop: spacing.sm,
    },
    deleteAccountText: {
      fontSize: fontSize.sm,
      color: '#EF4444',
    },
    version: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      textAlign: 'center',
      marginTop: spacing.xl,
    },
  });
}

interface SettingRowProps {
  icon: string;
  label: string;
  value?: string;
  isToggle?: boolean;
  toggleValue?: boolean;
  onPress?: () => void;
  styles: ReturnType<typeof createStyles>;
}

function SettingRow({
  icon,
  label,
  value,
  isToggle,
  toggleValue,
  onPress,
  styles,
}: SettingRowProps) {
  const content = (
    <>
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
    </>
  );

  if (onPress) {
    return (
      <AnimatedPress onPress={onPress} style={styles.row}>
        {content}
      </AnimatedPress>
    );
  }

  return <View style={styles.row}>{content}</View>;
}

export default function SettingsScreen() {
  const navigation = useNavigation();
  const { user, logout, deleteAccount, changePassword } = useAuthStore();
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { themeName, setTheme } = useThemeStore();
  const uiComplexity = useUIStore((s) => s.complexity);
  const setUIComplexity = useUIStore((s) => s.setComplexity);
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

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
    navigation.navigate('Import' as never);
  }, [navigation]);

  const handleExportModule = useCallback(async (mod: 'finance' | 'habits' | 'tasks') => {
    const labels = { finance: 'Финансы', habits: 'Привычки', tasks: 'Задачи' };
    try {
      const csv = await exportCSV(mod);
      const filename = `lifeos_${mod}_${new Date().toISOString().split('T')[0]}.csv`;
      const path = await saveCSVToFile(csv, filename);
      if (path) {
        Alert.alert('Экспорт готов', `Файл сохранён: ${filename}`);
      } else {
        Alert.alert('Готово', `${labels[mod]} экспортированы`);
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось экспортировать данные');
    }
  }, []);

  const handleExport = useCallback(() => {
    Alert.alert(
      'Экспорт данных',
      'Выберите что экспортировать:',
      [
        { text: '💰 Финансы (CSV)', onPress: () => handleExportModule('finance') },
        { text: '🏃 Привычки (CSV)', onPress: () => handleExportModule('habits') },
        { text: '📋 Задачи (CSV)', onPress: () => handleExportModule('tasks') },
        { text: 'Отмена', style: 'cancel' },
      ],
    );
  }, [handleExportModule]);

  const handleIntegrations = useCallback(() => {
    navigation.navigate('Integrations' as never);
  }, [navigation]);

  const handleSubscription = useCallback(() => {
    navigation.navigate('Subscription' as never);
  }, [navigation]);

  const handleTagManager = useCallback(() => {
    navigation.navigate('TagManager' as never);
  }, [navigation]);

  const handleSharedSpaces = useCallback(() => {
    navigation.navigate('SharedSpaces' as never);
  }, [navigation]);

  const handleChangePassword = useCallback(async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('��шибка', 'Заполните все поля');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Ошибка', 'Новый пароль должен быть минимум 8 символов');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Ошибка', 'Пароли не совпадают');
      return;
    }
    setPasswordLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      Alert.alert('Готово', 'Пароль успешно изменён');
      setShowPasswordChange(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка смены пароля';
      Alert.alert('Ошибка', message);
    } finally {
      setPasswordLoading(false);
    }
  }, [currentPassword, newPassword, confirmPassword, changePassword]);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Удалить аккаунт?',
      'Все данные будут безвозвратно удалены. Это действие нельзя отменить.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            Alert.prompt(
              'Подтвердите пароль',
              'Введите пароль для удаления аккаунта',
              async (password: string) => {
                if (!password) return;
                setDeleteLoading(true);
                try {
                  await deleteAccount(password);
                } catch (err) {
                  const message =
                    err instanceof Error ? err.message : 'Ошибка удаления';
                  Alert.alert('Ошибка', message);
                } finally {
                  setDeleteLoading(false);
                }
              },
              'secure-text',
              '',
              'default',
            );
          },
        },
      ],
    );
  }, [deleteAccount]);

  const handleLogout = useCallback(() => {
    Alert.alert('Выход', 'Вы уверены, что хотите выйти?', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Выйти',
        style: 'destructive',
        onPress: () => {
          logout();
        },
      },
    ]);
  }, [logout]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <FadeInView delay={0}>
        <SectionHeader title="Настройки" subtitle="Профиль, оформление и интеграции" />
      </FadeInView>

      <FadeInView delay={80}>
        <Text style={styles.sectionTitle}>Профиль</Text>
        <Card>
          <SettingRow icon="👤" label="Имя" value={user?.name ?? '—'} styles={styles} />
          <View style={styles.separator} />
          <SettingRow icon="📧" label="Почта" value={user?.email ?? '—'} styles={styles} />
          <View style={styles.separator} />
          <SettingRow
            icon="🔑"
            label="Сменить пароль"
            onPress={() => setShowPasswordChange(!showPasswordChange)}
            styles={styles}
          />
          {showPasswordChange && (
            <View style={styles.passwordChangeContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Текущий пароль"
                placeholderTextColor={c.textSecondary}
                secureTextEntry
                value={currentPassword}
                onChangeText={setCurrentPassword}
                autoCapitalize="none"
              />
              <TextInput
                style={styles.passwordInput}
                placeholder="Новый пароль (мин. 8 символов)"
                placeholderTextColor={c.textSecondary}
                secureTextEntry
                value={newPassword}
                onChangeText={setNewPassword}
                autoCapitalize="none"
              />
              <TextInput
                style={styles.passwordInput}
                placeholder="Подтвердите новый пароль"
                placeholderTextColor={c.textSecondary}
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                autoCapitalize="none"
                onSubmitEditing={handleChangePassword}
                returnKeyType="done"
              />
              <AnimatedPress
                onPress={handleChangePassword}
                disabled={passwordLoading}
                style={[styles.wakeUpSaveButton, passwordLoading && { opacity: 0.5 }]}
              >
                <Text style={styles.wakeUpSaveText}>
                  {passwordLoading ? 'Сохранение...' : 'Сохранить пароль'}
                </Text>
              </AnimatedPress>
            </View>
          )}
        </Card>
      </FadeInView>

      <FadeInView delay={160}>
        <Text style={styles.sectionTitle}>Оформление</Text>
        <Card>
          {THEME_OPTIONS.map((key, index) => (
            <View key={key}>
              {index > 0 && <View style={styles.separator} />}
              <AnimatedPress
                style={styles.row}
                onPress={() => setTheme(key)}
              >
                <View style={styles.rowLeft}>
                  <Text style={styles.rowIcon}>{themeIcons[key]}</Text>
                  <Text style={styles.rowLabel}>{themeLabels[key]}</Text>
                </View>
                <View
                  style={[
                    styles.radio,
                    themeName === key && styles.radioSelected,
                  ]}
                >
                  {themeName === key && <View style={styles.radioInner} />}
                </View>
              </AnimatedPress>
            </View>
          ))}
        </Card>
      </FadeInView>

      <FadeInView delay={240}>
        <Text style={styles.sectionTitle}>Уровень интерфейса</Text>
        <Card>
          {UI_COMPLEXITY_OPTIONS.map((opt, index) => (
            <View key={opt.key}>
              {index > 0 && <View style={styles.separator} />}
              <AnimatedPress
                style={styles.row}
                onPress={() => setUIComplexity(opt.key)}
              >
                <View style={styles.rowLeft}>
                  <Text style={styles.rowIcon}>{opt.icon}</Text>
                  <View>
                    <Text style={styles.rowLabel}>{opt.label}</Text>
                    <Text style={[styles.rowLabel, { fontSize: fontSize.xs, color: c.textMuted, fontWeight: '400' }]}>{opt.desc}</Text>
                  </View>
                </View>
                <View
                  style={[
                    styles.radio,
                    uiComplexity === opt.key && styles.radioSelected,
                  ]}
                >
                  {uiComplexity === opt.key && <View style={styles.radioInner} />}
                </View>
              </AnimatedPress>
            </View>
          ))}
        </Card>
      </FadeInView>

      <FadeInView delay={320}>
        <Text style={styles.sectionTitle}>Уведомления</Text>
        <Card>
          <SettingRow icon="🌅" label="Утреннее напоминание" isToggle toggleValue={morningReminder} onPress={handleToggleMorning} styles={styles} />
          <View style={styles.separator} />
          <SettingRow icon="🌙" label="Вечерний обзор" isToggle toggleValue={eveningReview} onPress={handleToggleEvening} styles={styles} />
          <View style={styles.separator} />
          <SettingRow icon="🔔" label="Напоминания о задачах" isToggle toggleValue={taskReminders} onPress={handleToggleTasks} styles={styles} />
        </Card>
      </FadeInView>

      <FadeInView delay={400}>
        <Text style={styles.sectionTitle}>Ассистент</Text>
        <Card>
          {ASSISTANT_STYLES.map((style, index) => (
            <View key={style.key}>
              {index > 0 && <View style={styles.separator} />}
              <AnimatedPress
                style={styles.row}
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
              </AnimatedPress>
            </View>
          ))}
        </Card>
      </FadeInView>

      <FadeInView delay={480}>
        <Card>
          <Text style={styles.settingLabel}>Голос ассистента</Text>
          <View style={styles.genderRow}>
            <AnimatedPress
              style={[styles.genderOption, assistantGender === 'female' && styles.genderOptionSelected]}
              onPress={() => handleGenderChange('female')}
            >
              <Text style={styles.genderOptionText}>Женский</Text>
            </AnimatedPress>
            <AnimatedPress
              style={[styles.genderOption, assistantGender === 'male' && styles.genderOptionSelected]}
              onPress={() => handleGenderChange('male')}
            >
              <Text style={styles.genderOptionText}>Мужской</Text>
            </AnimatedPress>
          </View>
          <View style={styles.separator} />
          <AnimatedPress style={styles.row} onPress={handleWakeUpTimeEdit}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowIcon}>{'\u23F0'}</Text>
              <Text style={styles.rowLabel}>Время пробуждения</Text>
            </View>
            <Text style={styles.rowValue}>{wakeUpTime}</Text>
          </AnimatedPress>
          {editingWakeUpTime && (
            <View style={styles.wakeUpEditRow}>
              <TextInput
                style={styles.wakeUpInput}
                value={wakeUpTimeInput}
                onChangeText={setWakeUpTimeInput}
                placeholder="ЧЧ:ММ"
                placeholderTextColor={c.textSecondary}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                autoFocus
                onSubmitEditing={handleWakeUpTimeSave}
                returnKeyType="done"
              />
              <AnimatedPress style={styles.wakeUpSaveButton} onPress={handleWakeUpTimeSave}>
                <Text style={styles.wakeUpSaveText}>Сохранить</Text>
              </AnimatedPress>
            </View>
          )}
        </Card>
      </FadeInView>

      <FadeInView delay={560}>
        <Text style={styles.sectionTitle}>Данные</Text>
        <Card>
          <SettingRow icon="📥" label="Импорт файлов" onPress={handleImport} styles={styles} />
          <View style={styles.separator} />
          <SettingRow icon="📤" label="Экспорт данных" onPress={() => (navigation as any).navigate('Export')} styles={styles} />
          <View style={styles.separator} />
          <SettingRow icon="🔗" label="Интеграции" onPress={handleIntegrations} styles={styles} />
        </Card>
      </FadeInView>

      <FadeInView delay={640}>
        <Text style={styles.sectionTitle}>Продвинутое</Text>
        <Card>
          <SettingRow icon="⭐" label="Подписка PRO" onPress={handleSubscription} styles={styles} />
          <View style={styles.separator} />
          <SettingRow icon="🏷️" label="Теги" onPress={handleTagManager} styles={styles} />
          <View style={styles.separator} />
          <SettingRow icon="👥" label="Общие пространства" onPress={handleSharedSpaces} styles={styles} />
          <View style={styles.separator} />
          <SettingRow icon="📜" label="Политика конфиденциальности" onPress={() => (navigation as any).navigate('Legal')} styles={styles} />
        </Card>
      </FadeInView>

      <FadeInView delay={720}>
        <Text style={styles.sectionTitle}>Аккаунт</Text>
        <Card style={styles.dangerCard}>
          <Button title="Выйти из аккаунта" onPress={handleLogout} variant="danger" style={styles.logoutButton} />
        </Card>

        <AnimatedPress
          style={styles.deleteAccountButton}
          onPress={handleDeleteAccount}
          disabled={deleteLoading}
        >
          <Text style={styles.deleteAccountText}>
            {deleteLoading ? 'Удаление...' : 'Удалить аккаунт'}
          </Text>
        </AnimatedPress>

        <Text style={styles.version}>LifeOS v1.0.0</Text>
      </FadeInView>
    </ScrollView>
  );
}
