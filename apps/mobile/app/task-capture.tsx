import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Switch,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { spacing, fontSize, borderRadius } from '@/constants';
import { taskCategories } from '@/constants/categories';
import { SectionHeader } from '@/components/ui';
import { useColors } from '@/hooks/use-colors';

// Image size budget — 1.5 MB before base64
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

type Priority = 'low' | 'medium' | 'high' | 'critical';
type CapturedTask = {
  title: string;
  category: string;
  priority: Priority;
  time?: string;
  notes?: string;
  confidence?: 'high' | 'medium' | 'low';
  selected: boolean;
};

type CaptureResponse = {
  summary: string;
  tasks: Array<Omit<CapturedTask, 'selected'>>;
};

const PRIORITY_EMOJI: Record<Priority, string> = {
  low: '🟢',
  medium: '🔵',
  high: '🔥',
  critical: '🔴',
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'высокая',
  medium: 'средняя',
  low: 'низкая',
};

/**
 * Smart Task Capture
 *
 * Flow:
 *   1. User taps "Camera" or "Gallery"
 *   2. Image uploaded to /vision/capture-task
 *   3. Claude Vision returns { summary, tasks[] }
 *   4. User reviews, toggles which to save, edits inline, adds optional hint
 *   5. Tap "Сохранить" → POST /vision/save-captured-tasks → back to tasks tab
 *
 * Pairs with `/vision/capture-task` server endpoint.
 */
export default function TaskCapture() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  const nav = useNavigation<any>();
  const token = useAuthStore((s) => s.token);

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState('');
  const [tasks, setTasks] = useState<CapturedTask[]>([]);
  const [hint, setHint] = useState('');
  const [showHint, setShowHint] = useState(false);

  const selectedCount = useMemo(
    () => tasks.filter((t) => t.selected).length,
    [tasks],
  );

  const pickFromCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Нет доступа', 'Разреши доступ к камере в настройках.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.25,
      base64: false,
      allowsEditing: false,
      exif: false,
    });
    if (!result.canceled && result.assets[0]) {
      await handlePicked(result.assets[0].uri);
    }
  }, []);

  const pickFromLibrary = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.3,
      base64: false,
      allowsEditing: false,
      exif: false,
    });
    if (!result.canceled && result.assets[0]) {
      await handlePicked(result.assets[0].uri);
    }
  }, []);

  const handlePicked = useCallback(
    async (uri: string) => {
      setImageUri(uri);
      setTasks([]);
      setSummary('');
      try {
        const info = await FileSystem.getInfoAsync(uri);
        const size = (info as { size?: number }).size ?? 0;
        if (size > MAX_IMAGE_BYTES) {
          Alert.alert(
            'Фото слишком большое',
            `${(size / 1024 / 1024).toFixed(1)} MB — максимум ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(1)} MB. Попробуй ещё раз.`,
          );
          return;
        }
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await analyzeImage(base64);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Не удалось прочитать фото';
        Alert.alert('Ошибка', msg);
      }
    },
    [],
  );

  const analyzeImage = useCallback(
    async (base64: string) => {
      if (!token) return;
      setAnalyzing(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      try {
        const data = await api.post<CaptureResponse>(
          '/vision/capture-task',
          { image: base64, mediaType: 'image/jpeg', hint: hint || undefined },
          token,
        );
        setSummary(data.summary || '');
        setTasks(
          (data.tasks || []).map((t) => ({
            title: t.title,
            category: t.category || 'personal',
            priority: t.priority || 'medium',
            time: t.time,
            notes: t.notes,
            confidence: t.confidence,
            selected: true,
          })),
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch (err) {
        console.warn('[task-capture] analyze error', err);
        const rawMsg = err instanceof Error ? err.message : 'Не удалось распознать';
        Alert.alert('Ошибка', rawMsg);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      } finally {
        setAnalyzing(false);
      }
    },
    [token, hint],
  );

  const toggleTask = useCallback((idx: number) => {
    Haptics.selectionAsync().catch(() => {});
    setTasks((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, selected: !t.selected } : t)),
    );
  }, []);

  const editTaskTitle = useCallback((idx: number, title: string) => {
    setTasks((prev) => prev.map((t, i) => (i === idx ? { ...t, title } : t)));
  }, []);

  const saveTasks = useCallback(async () => {
    if (!token) return;
    const toSave = tasks.filter((t) => t.selected);
    if (toSave.length === 0) {
      Alert.alert('Нечего сохранять', 'Выбери хотя бы одну задачу.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ ok: boolean; created: number }>(
        '/vision/save-captured-tasks',
        {
          tasks: toSave.map((t) => ({
            title: t.title,
            category: t.category,
            priority: t.priority,
            time: t.time,
            notes: t.notes,
          })),
        },
        token,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(
        'Готово',
        `Сохранено задач: ${res.created}`,
        [{ text: 'OK', onPress: () => nav.goBack() }],
      );
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Ошибка сохранения';
      Alert.alert('Ошибка', rawMsg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setSaving(false);
    }
  }, [token, tasks, nav]);

  const reset = useCallback(() => {
    setImageUri(null);
    setTasks([]);
    setSummary('');
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => nav.goBack()}
        hitSlop={10}
      >
        <Feather name="arrow-left" size={24} color={c.text} />
      </TouchableOpacity>
      <SectionHeader title="Умная камера" subtitle="Сфотографируй задачи и расписание" />

      <ScrollView contentContainerStyle={styles.scroll}>
        {!imageUri && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Сфотографируй что угодно</Text>
            <Text style={styles.emptyHint}>
              Записка, ватсап-чат, доска, список покупок, квитанция, скриншот — всё что содержит задачи.
              AI извлечёт структурированный список.
            </Text>

            <View style={styles.hintRow}>
              <Switch value={showHint} onValueChange={setShowHint} />
              <Text style={styles.hintLabel}>Добавить подсказку для AI</Text>
            </View>
            {showHint && (
              <TextInput
                style={styles.hintInput}
                placeholder="Например: это план на субботу от Серика"
                placeholderTextColor={c.textSecondary}
                value={hint}
                onChangeText={setHint}
                multiline
              />
            )}

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={pickFromCamera}
              activeOpacity={0.85}
            >
              <Feather name="camera" size={22} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>Сделать фото</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={pickFromLibrary}
              activeOpacity={0.85}
            >
              <Feather name="image" size={22} color={c.text} />
              <Text style={styles.secondaryButtonText}>Из галереи</Text>
            </TouchableOpacity>
          </View>
        )}

        {imageUri && (
          <>
            <Image source={{ uri: imageUri }} style={styles.preview} />
            <TouchableOpacity onPress={reset} style={styles.resetLink}>
              <Text style={styles.resetText}>← выбрать другое фото</Text>
            </TouchableOpacity>
          </>
        )}

        {analyzing && (
          <View style={styles.analyzingBox}>
            <ActivityIndicator size="large" color={c.primary} />
            <Text style={styles.analyzingText}>AI распознаёт задачи…</Text>
          </View>
        )}

        {!analyzing && summary !== '' && (
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Что увидел AI:</Text>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        )}

        {!analyzing && tasks.length > 0 && (
          <View style={styles.tasksSection}>
            <Text style={styles.sectionTitle}>
              Задачи ({selectedCount}/{tasks.length} выбрано)
            </Text>
            {tasks.map((task, idx) => {
              const cat = taskCategories[task.category as keyof typeof taskCategories];
              return (
                <View
                  key={idx}
                  style={[
                    styles.taskCard,
                    task.selected && styles.taskCardSelected,
                  ]}
                >
                  <TouchableOpacity
                    style={styles.taskCheckbox}
                    onPress={() => toggleTask(idx)}
                    hitSlop={10}
                  >
                    <Feather
                      name={task.selected ? 'check-circle' : 'circle'}
                      size={22}
                      color={task.selected ? c.primary : c.textSecondary}
                    />
                  </TouchableOpacity>
                  <View style={styles.taskBody}>
                    <TextInput
                      value={task.title}
                      onChangeText={(v) => editTaskTitle(idx, v)}
                      style={styles.taskTitle}
                      multiline
                    />
                    <View style={styles.taskMeta}>
                      <Text style={styles.taskMetaItem}>
                        {PRIORITY_EMOJI[task.priority]} {task.priority}
                      </Text>
                      {cat && (
                        <Text style={styles.taskMetaItem}>
                          {cat.icon} {cat.label}
                        </Text>
                      )}
                      {task.time && (
                        <Text style={styles.taskMetaItem}>⏰ {task.time}</Text>
                      )}
                      {task.confidence && (
                        <Text style={styles.taskMetaItem}>
                          🎯 {CONFIDENCE_LABEL[task.confidence]}
                        </Text>
                      )}
                    </View>
                    {task.notes && (
                      <Text style={styles.taskNotes}>{task.notes}</Text>
                    )}
                  </View>
                </View>
              );
            })}

            <TouchableOpacity
              style={[styles.primaryButton, saving && styles.disabled]}
              onPress={saveTasks}
              disabled={saving || selectedCount === 0}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Feather name="check" size={22} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>
                    Сохранить {selectedCount} задач
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: c.background,
  },
  backButton: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  scroll: {
    padding: spacing.md,
    paddingBottom: 80,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    color: c.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyHint: {
    color: c.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  hintLabel: {
    color: c.textSecondary,
    fontSize: fontSize.sm,
  },
  hintInput: {
    backgroundColor: c.surface,
    color: c.text,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    width: '100%',
    minHeight: 60,
    marginBottom: spacing.lg,
    fontSize: fontSize.md,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: c.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    width: '100%',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    width: '100%',
    borderWidth: 1,
    borderColor: c.border,
  },
  secondaryButtonText: {
    color: c.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  preview: {
    width: '100%',
    height: 220,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
  },
  resetLink: {
    alignSelf: 'center',
    padding: spacing.sm,
  },
  resetText: {
    color: c.textSecondary,
    fontSize: fontSize.sm,
  },
  analyzingBox: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  analyzingText: {
    color: c.textSecondary,
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
  },
  summaryBox: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryLabel: {
    color: c.textSecondary,
    fontSize: fontSize.xs,
    marginBottom: 4,
  },
  summaryText: {
    color: c.text,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  tasksSection: {
    marginTop: spacing.sm,
  },
  sectionTitle: {
    color: c.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  taskCard: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: c.border,
  },
  taskCardSelected: {
    borderColor: c.primary,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
  },
  taskCheckbox: {
    marginRight: spacing.sm,
    paddingTop: 2,
  },
  taskBody: {
    flex: 1,
  },
  taskTitle: {
    color: c.text,
    fontSize: fontSize.md,
    fontWeight: '600',
    lineHeight: 22,
    padding: 0,
  },
  taskMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 6,
  },
  taskMetaItem: {
    color: c.textSecondary,
    fontSize: fontSize.xs,
  },
  taskNotes: {
    color: c.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 4,
    fontStyle: 'italic',
  },
  });
}
