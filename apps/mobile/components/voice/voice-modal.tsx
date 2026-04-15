import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Modal } from '@/components/ui';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';

interface VoiceIntent {
  action: string;
  [key: string]: unknown;
}

interface VoiceResult {
  intent: VoiceIntent;
  response: string;
}

interface VoiceModalProps {
  visible: boolean;
  onClose: () => void;
  isRecording: boolean;
  isProcessing: boolean;
  result: VoiceResult | null;
  error: string | null;
  onExecuteAction?: (action: string, params: Record<string, unknown>) => Promise<void>;
}

const ACTION_LABELS: Record<string, string> = {
  create_task: 'Создание задачи',
  complete_task: 'Завершение задачи',
  complete_habit: 'Отметка привычки',
  add_expense: 'Добавление расхода',
  add_income: 'Добавление дохода',
  get_summary: 'Сводка',
  get_finance: 'Финансовый отчёт',
  unknown: 'Неизвестная команда',
};

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

const EXECUTABLE_ACTIONS = new Set([
  'create_task',
  'complete_task',
  'complete_habit',
  'add_expense',
  'add_income',
]);

const ACTION_CONFIRM_LABELS: Record<string, string> = {
  create_task: '✅ Создать задачу',
  complete_task: '✅ Завершить задачу',
  complete_habit: '✅ Отметить привычку',
  add_expense: '✅ Записать расход',
  add_income: '✅ Записать доход',
};

function getActionPreview(action: string, params: Record<string, unknown>): string {
  switch (action) {
    case 'create_task':
      return `Задача: «${params.title ?? ''}»\nДата: ${params.date ?? 'сегодня'}`;
    case 'complete_task':
      return `Завершить задачу: «${params.taskTitle ?? ''}»`;
    case 'complete_habit':
      return `Отметить привычку: «${params.habitName ?? ''}»`;
    case 'add_expense':
      return `Расход: ${params.amount ?? 0} ₸ — ${params.description ?? params.category ?? 'прочее'}`;
    case 'add_income':
      return `Доход: ${params.amount ?? 0} ₸ — ${params.source ?? ''}`;
    default:
      return '';
  }
}

export const VoiceModal = React.memo(function VoiceModal({
  visible,
  onClose,
  isRecording,
  isProcessing,
  result,
  error,
  onExecuteAction,
}: VoiceModalProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [executing, setExecuting] = useState(false);
  const [executed, setExecuted] = useState(false);

  const canExecute = result
    && !isRecording
    && !isProcessing
    && EXECUTABLE_ACTIONS.has(result.intent.action)
    && onExecuteAction
    && !executed;

  const handleExecute = async () => {
    if (!result || !onExecuteAction) return;
    setExecuting(true);
    try {
      const { action, ...params } = result.intent;
      await onExecuteAction(action, params);
      setExecuted(true);
    } finally {
      setExecuting(false);
    }
  };

  const handleClose = () => {
    setExecuted(false);
    setExecuting(false);
    onClose();
  };

  return (
    <Modal visible={visible} onClose={handleClose} title="Голосовой помощник">
      <View style={styles.container}>
        {isRecording && (
          <View style={styles.stateContainer}>
            <View style={styles.recordingDot} />
            <Text style={styles.stateText}>Слушаю...</Text>
          </View>
        )}

        {isProcessing && (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="small" color={c.primary} />
            <Text style={styles.stateText}>Обрабатываю...</Text>
          </View>
        )}

        {error && !isRecording && !isProcessing && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {result && !isRecording && !isProcessing && (
          <View style={styles.resultContainer}>
            <View style={styles.actionBadge}>
              <Text style={styles.actionText}>
                {getActionLabel(result.intent.action)}
              </Text>
            </View>

            <Text style={styles.responseLabel}>Ответ:</Text>
            <Text style={styles.responseText}>{result.response}</Text>

            {/* Action preview and execute button */}
            {EXECUTABLE_ACTIONS.has(result.intent.action) && onExecuteAction && (
              <View style={styles.actionSection}>
                <View style={styles.previewCard}>
                  <Text style={styles.previewText}>
                    {getActionPreview(result.intent.action, result.intent)}
                  </Text>
                </View>

                {executed ? (
                  <View style={styles.executedBadge}>
                    <Text style={styles.executedText}>Выполнено ✓</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.executeButton}
                    onPress={handleExecute}
                    disabled={executing}
                    activeOpacity={0.7}
                  >
                    {executing ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.executeButtonText}>
                        {ACTION_CONFIRM_LABELS[result.intent.action] ?? 'Выполнить'}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {!isRecording && !isProcessing && !result && !error && (
          <Text style={styles.hintText}>
            Нажмите на кнопку микрофона и произнесите команду
          </Text>
        )}
      </View>
    </Modal>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      minHeight: 120,
      paddingVertical: spacing.md,
    },
    stateContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.lg,
    },
    stateText: {
      color: c.text,
      fontSize: fontSize.lg,
      fontWeight: '600',
    },
    recordingDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: c.danger,
    },
    errorContainer: {
      backgroundColor: 'rgba(239, 68, 68, 0.15)',
      borderRadius: borderRadius.md,
      padding: spacing.md,
    },
    errorText: {
      color: c.danger,
      fontSize: fontSize.sm,
      textAlign: 'center',
    },
    resultContainer: {
      gap: spacing.md,
    },
    actionBadge: {
      alignSelf: 'flex-start',
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    actionText: {
      color: c.primary,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    responseLabel: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    responseText: {
      color: c.text,
      fontSize: fontSize.md,
      lineHeight: 24,
    },
    hintText: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      textAlign: 'center',
      paddingVertical: spacing.lg,
    },
    actionSection: {
      marginTop: spacing.md,
      gap: spacing.sm,
    },
    previewCard: {
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.md,
      padding: spacing.md,
    },
    previewText: {
      color: c.text,
      fontSize: fontSize.sm,
      lineHeight: 20,
    },
    executeButton: {
      backgroundColor: c.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
    },
    executeButtonText: {
      color: '#FFFFFF',
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    executedBadge: {
      backgroundColor: 'rgba(34, 197, 94, 0.15)',
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    executedText: {
      color: '#22C55E',
      fontSize: fontSize.md,
      fontWeight: '600',
    },
  });
}
