import React, { memo, useCallback, useMemo, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { pitchAnswer, type PitchQuestion } from '@/services/onboarding-pitch';

const { width } = Dimensions.get('window');

/**
 * Один вопрос знакомства: «да / нет» → карточка с сильной стороной LifeOS под
 * этот ответ (services/onboarding-pitch.ts). Ответ можно поменять.
 */
export const PitchQuestionSlide = memo(function PitchQuestionSlide({
  q,
  onAnswer,
}: {
  q: PitchQuestion;
  onAnswer: (id: string, answer: 'yes' | 'no') => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);
  const [notif, setNotif] = useState<'idle' | 'on' | 'off'>('idle');
  const text = pitchAnswer(q, answer);

  const pick = useCallback(
    (a: 'yes' | 'no') => {
      Haptics.selectionAsync().catch(() => {});
      setAnswer(a);
      onAnswer(q.id, a);
    },
    [q.id, onAnswer],
  );

  const enableNotifications = useCallback(async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotif(status === 'granted' ? 'on' : 'off');
      if (status === 'granted') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      setNotif('off');
    }
  }, []);

  return (
    <View style={styles.slide}>
      <Animated.Text entering={ZoomIn.duration(350)} style={styles.icon}>
        {q.icon}
      </Animated.Text>
      <Text style={styles.question}>{q.question}</Text>
      <View style={styles.buttons}>
        <Pressable
          style={[styles.btn, answer === 'yes' && styles.btnOn]}
          onPress={() => pick('yes')}
          accessibilityRole="button"
          accessibilityState={{ selected: answer === 'yes' }}
        >
          <Text style={[styles.btnText, answer === 'yes' && styles.btnTextOn]}>Да</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, answer === 'no' && styles.btnOn]}
          onPress={() => pick('no')}
          accessibilityRole="button"
          accessibilityState={{ selected: answer === 'no' }}
        >
          <Text style={[styles.btnText, answer === 'no' && styles.btnTextOn]}>Нет</Text>
        </Pressable>
      </View>
      {text ? (
        <Animated.View key={answer} entering={FadeInDown.duration(350)} style={styles.answer}>
          <Text style={styles.answerText}>{text}</Text>
          {q.action === 'notifications' ? (
            notif === 'on' ? (
              <Text style={styles.done}>Уведомления включены ✓</Text>
            ) : (
              <Pressable style={styles.action} onPress={enableNotifications} accessibilityRole="button">
                <Text style={styles.actionText}>
                  {notif === 'off' ? 'Можно включить потом в Настройках' : '🔔 Включить уведомления'}
                </Text>
              </Pressable>
            )
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    slide: { width, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
    icon: { fontSize: 76, marginBottom: spacing.lg },
    question: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
      textAlign: 'center',
      lineHeight: 30,
      marginBottom: spacing.lg,
    },
    buttons: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
    btn: {
      minWidth: 120,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.xl,
      borderWidth: 2,
      borderColor: c.primary,
      alignItems: 'center',
    },
    btnOn: { backgroundColor: c.primary },
    btnText: { fontSize: fontSize.lg, fontWeight: '700', color: c.primary },
    btnTextOn: { color: c.background },
    answer: {
      width: '100%',
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      padding: spacing.md,
      gap: spacing.sm,
      borderLeftWidth: 4,
      borderLeftColor: c.primary,
    },
    answerText: { fontSize: fontSize.md, color: c.text, lineHeight: 23 },
    action: {
      alignSelf: 'flex-start',
      backgroundColor: c.primary,
      borderRadius: borderRadius.xl,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    actionText: { color: c.background, fontWeight: '700', fontSize: fontSize.sm },
    done: { color: c.success, fontWeight: '700', fontSize: fontSize.sm },
  });
}
