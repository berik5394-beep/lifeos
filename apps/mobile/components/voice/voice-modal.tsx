import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Modal } from '@/components/ui';
import { colors, spacing, fontSize, borderRadius } from '@/constants';

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

export const VoiceModal = React.memo(function VoiceModal({
  visible,
  onClose,
  isRecording,
  isProcessing,
  result,
  error,
}: VoiceModalProps) {
  return (
    <Modal visible={visible} onClose={onClose} title="Голосовой помощник">
      <View style={styles.container}>
        {isRecording && (
          <View style={styles.stateContainer}>
            <View style={styles.recordingDot} />
            <Text style={styles.stateText}>Слушаю...</Text>
          </View>
        )}

        {isProcessing && (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
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

const styles = StyleSheet.create({
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
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.danger,
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  resultContainer: {
    gap: spacing.md,
  },
  actionBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  responseLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  responseText: {
    color: colors.text,
    fontSize: fontSize.md,
    lineHeight: 24,
  },
  hintText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
