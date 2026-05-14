import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Easing,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { useDictation, type DictationResult } from '@/hooks/use-dictation';

interface DictationModalProps {
  visible: boolean;
  onClose: () => void;
  onResult?: (result: DictationResult) => void;
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}

/**
 * JARVIS dictation modal — нажми, говори свободно, отпусти. Сервер вытащит
 * задачи + запомнит факты, ассистент скажет подтверждение голосом.
 *
 * Состояния:
 *  - idle: показываем большую кнопку "Начать запись"
 *  - recording: пульсирующий красный круг + таймер + кнопка "Стоп"
 *  - processing: спиннер + "Разбираю запись..."
 *  - done: summary + список созданных задач/памяти + кнопка "Закрыть"
 *  - error: текст ошибки + "Попробовать снова"
 */
export function DictationModal({ visible, onClose, onResult }: DictationModalProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const { state, isRecording, isProcessing, error, result, durationSec, start, stop, cancel, reset } =
    useDictation();

  const pulse = useRef(new Animated.Value(1)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Авто-старт записи при открытии модалки
  useEffect(() => {
    if (visible && state === 'idle') {
      start();
    }
    if (!visible) {
      cancel();
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Уведомляем родителя о результате
  useEffect(() => {
    if (state === 'done' && result && onResult) {
      onResult(result);
    }
  }, [state, result, onResult]);

  // Pulse-анимация во время записи
  useEffect(() => {
    if (isRecording) {
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.2,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      pulseLoopRef.current.start();
    } else {
      pulseLoopRef.current?.stop();
      pulse.setValue(1);
    }
  }, [isRecording, pulse]);

  const handleClose = useCallback(() => {
    cancel();
    reset();
    onClose();
  }, [cancel, reset, onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>JARVIS Диктофон</Text>
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Закрыть"
          >
            <Feather name="x" size={26} color={c.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {state === 'recording' && (
            <View style={styles.centered}>
              <Animated.View style={[styles.pulseCircle, { transform: [{ scale: pulse }] }]}>
                <Feather name="mic" size={64} color="#fff" />
              </Animated.View>
              <Text style={styles.timer}>{formatDuration(durationSec)}</Text>
              <Text style={styles.hint}>Говори свободно. Я выделю задачи и запомню важное.</Text>
              <TouchableOpacity
                style={styles.stopButton}
                onPress={stop}
                accessibilityRole="button"
                accessibilityLabel="Остановить запись и обработать"
              >
                <Feather name="square" size={22} color="#fff" />
                <Text style={styles.stopButtonText}>Готово</Text>
              </TouchableOpacity>
            </View>
          )}

          {state === 'processing' && (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={c.primary} />
              <Text style={styles.statusText}>Разбираю запись...</Text>
              <Text style={styles.hint}>Транскрипция + извлечение задач и фактов</Text>
            </View>
          )}

          {state === 'done' && result && (
            <ScrollView contentContainerStyle={styles.resultScroll}>
              <View style={styles.successCheck}>
                <Feather name="check-circle" size={48} color={c.success} />
              </View>
              <Text style={styles.summaryText}>{result.summary}</Text>

              {result.tasksCreated.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    📝 Задачи ({result.tasksCreated.length})
                  </Text>
                  {result.tasksCreated.map((t) => (
                    <View key={t.id} style={styles.itemRow}>
                      <Text style={styles.itemText}>• {t.title}</Text>
                      <Text style={styles.itemMeta}>
                        {t.date}
                        {t.time ? ` · ${t.time}` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {result.memoriesCreated.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    🧠 Запомнил ({result.memoriesCreated.length})
                  </Text>
                  {result.memoriesCreated.map((m) => (
                    <View key={m.id} style={styles.itemRow}>
                      <Text style={styles.itemText}>· {m.content}</Text>
                      {m.tags && m.tags.length > 0 && (
                        <Text style={styles.itemMeta}>#{m.tags.join(' #')}</Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel="Закрыть"
              >
                <Text style={styles.primaryButtonText}>Готово</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {state === 'error' && (
            <View style={styles.centered}>
              <Feather name="alert-circle" size={48} color={c.danger} />
              <Text style={styles.errorText}>{error || 'Ошибка'}</Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => {
                  reset();
                  start();
                }}
                accessibilityRole="button"
                accessibilityLabel="Попробовать снова"
              >
                <Text style={styles.primaryButtonText}>Попробовать снова</Text>
              </TouchableOpacity>
            </View>
          )}

          {state === 'idle' && (
            <View style={styles.centered}>
              <ActivityIndicator size="small" color={c.textSecondary} />
              <Text style={styles.statusText}>Подготовка...</Text>
            </View>
          )}
        </View>

        {(isRecording || isProcessing) && (
          <Text style={styles.processingHint}>
            {isProcessing
              ? 'Обычно занимает 5-15 секунд в зависимости от длительности записи.'
              : 'Лимит записи — 5 минут. Авто-стоп.'}
          </Text>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    title: { fontSize: fontSize.lg, fontWeight: '700', color: c.text },
    body: { flex: 1, padding: spacing.lg },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
    },
    pulseCircle: {
      width: 160,
      height: 160,
      borderRadius: 80,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: c.danger,
      shadowOpacity: 0.5,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 0 },
    },
    timer: {
      fontSize: 42,
      fontWeight: '300',
      color: c.text,
      fontVariant: ['tabular-nums'],
      marginTop: spacing.md,
    },
    hint: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      textAlign: 'center',
      paddingHorizontal: spacing.lg,
    },
    statusText: {
      fontSize: fontSize.md,
      color: c.text,
      marginTop: spacing.md,
    },
    stopButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: c.primary,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xl,
      borderRadius: borderRadius.lg,
      marginTop: spacing.xl,
    },
    stopButtonText: { color: '#fff', fontSize: fontSize.md, fontWeight: '600' },
    resultScroll: { padding: spacing.md, gap: spacing.md },
    successCheck: { alignItems: 'center', marginVertical: spacing.lg },
    summaryText: {
      fontSize: fontSize.md,
      color: c.text,
      textAlign: 'center',
      paddingHorizontal: spacing.md,
    },
    section: {
      marginTop: spacing.lg,
      padding: spacing.md,
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
    },
    sectionTitle: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
      marginBottom: spacing.sm,
    },
    itemRow: { paddingVertical: spacing.xs },
    itemText: { fontSize: fontSize.md, color: c.text },
    itemMeta: { fontSize: fontSize.xs, color: c.textMuted, marginTop: 2 },
    primaryButton: {
      backgroundColor: c.primary,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.lg,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    primaryButtonText: { color: '#fff', fontSize: fontSize.md, fontWeight: '600' },
    errorText: {
      fontSize: fontSize.md,
      color: c.danger,
      textAlign: 'center',
      paddingHorizontal: spacing.md,
    },
    processingHint: {
      fontSize: fontSize.xs,
      color: c.textMuted,
      textAlign: 'center',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
    },
  });
}
