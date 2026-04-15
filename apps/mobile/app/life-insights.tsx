import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Card } from '@/components/ui/card';
import { AnimatedPress } from '@/components/ui/animated-press';
import { FadeInView } from '@/components/ui/fade-in-view';
import { AnimatedProgressBar } from '@/components/ui/animated-progress-bar';
import { SkeletonList } from '@/components/ui/skeleton';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { api } from '@/services/api';
import type { Theme } from '@/constants/themes';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ---------- Types ----------

interface MoneyDrain {
  category: string;
  label: string;
  amount: number;
  percent: number;
  color: string;
}

interface FinancialTruth {
  monthlyBurnRate: number;
  savingsRate: number;
  topDrains: MoneyDrain[];
  apartmentTimeline: string;
  daysUntilBroke: number | null;
  dailyLifeCost: number;
  badDecisions: string[];
  cashFlowGaps: string[];
}

interface HealthTruth {
  sleepHours: number;
  sleepVerdict: string;
  sleepSeverity: 'good' | 'warning' | 'danger';
  stepsPerDay: number;
  stepsVerdict: string;
  stepsSeverity: 'good' | 'warning' | 'danger';
  exerciseFrequency: string;
  burnoutRisk: number;
  bodyWarnings: string[];
  mentalHealthFlags: string[];
}

interface LifeProgress {
  goalsOnTrack: number;
  goalsBehind: number;
  goalsTotal: number;
  habitConsistency: number;
  worstHabits: { name: string; completion: number }[];
  productivityTrend: 'up' | 'down' | 'flat';
  currentStreak: number;
}

interface ExitStrategy {
  id: string;
  text: string;
  actionType: 'task' | 'habit';
  actionData: Record<string, string>;
}

interface LifeAnalysis {
  financial: FinancialTruth;
  health: HealthTruth;
  progress: LifeProgress;
  aiVerdict: string;
  exitStrategies: ExitStrategy[];
  generatedAt: string;
}

// ---------- Helpers ----------

function formatMoney(amount: number): string {
  return amount.toLocaleString('ru-RU') + ' ₸';
}

function severityColor(severity: 'good' | 'warning' | 'danger', c: Theme): string {
  switch (severity) {
    case 'good':
      return c.success;
    case 'warning':
      return '#F59E0B';
    case 'danger':
      return c.danger;
  }
}

function trendIcon(trend: 'up' | 'down' | 'flat'): string {
  switch (trend) {
    case 'up':
      return '\u2191';
    case 'down':
      return '\u2193';
    case 'flat':
      return '\u2192';
  }
}

function trendColor(trend: 'up' | 'down' | 'flat', c: Theme): string {
  switch (trend) {
    case 'up':
      return c.success;
    case 'down':
      return c.danger;
    case 'flat':
      return '#F59E0B';
  }
}

// ---------- Sub-components ----------

const SeverityDot = React.memo(function SeverityDot({
  severity,
}: {
  severity: 'good' | 'warning' | 'danger';
}) {
  const c = useColors();
  const color = severityColor(severity, c);
  return (
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: color,
        marginRight: spacing.xs,
      }}
    />
  );
});

// ---------- Main Screen ----------

export default function LifeInsightsScreen() {
  const navigation = useNavigation<any>();
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  const [data, setData] = useState<LifeAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [verdictExpanded, setVerdictExpanded] = useState(false);
  const [exitVisible, setExitVisible] = useState(false);
  const [creatingAction, setCreatingAction] = useState<string | null>(null);

  const fetchAnalysis = useCallback(async () => {
    try {
      const result = await api.post<LifeAnalysis>('/ai/life-analysis', {});
      setData(result);
    } catch {
      // keep stale data if available
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchAnalysis();
      setLoading(false);
    })();
  }, [fetchAnalysis]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAnalysis();
    setRefreshing(false);
  }, [fetchAnalysis]);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Tabs' as never);
    }
  }, [navigation]);

  const toggleVerdict = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setVerdictExpanded((prev) => !prev);
  }, []);

  const toggleExit = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExitVisible((prev) => !prev);
  }, []);

  const handleCreateAction = useCallback(
    async (strategy: ExitStrategy) => {
      setCreatingAction(strategy.id);
      try {
        if (strategy.actionType === 'task') {
          await api.post('/tasks', strategy.actionData);
        } else {
          await api.post('/habits', strategy.actionData);
        }
      } catch {
        // silent fail
      } finally {
        setCreatingAction(null);
      }
    },
    [],
  );

  const today = new Date().toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // ---------- Render ----------

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color={c.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Правда о твоей жизни</Text>
        </View>
        <SkeletonList count={4} />
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color={c.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Правда о твоей жизни</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyText}>
            Не удалось загрузить анализ. Потяните вниз для обновления.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const { financial, health, progress, aiVerdict, exitStrategies } = data;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={c.primary}
          />
        }
      >
        {/* Header */}
        <FadeInView delay={0}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={handleBack} style={styles.backButton}>
              <Feather name="arrow-left" size={24} color={c.text} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Правда о твоей жизни</Text>
              <Text style={styles.headerDate}>{today}</Text>
            </View>
          </View>
        </FadeInView>

        {/* Financial Truth */}
        <FadeInView delay={100}>
          <AnimatedPress>
            <Card
              style={[
                styles.sectionCard,
                {
                  borderColor:
                    financial.savingsRate < 0 ? c.danger : c.success,
                  borderWidth: 1.5,
                },
              ]}
            >
              <Text style={styles.sectionTitle}>
                {'💰'} Финансовая правда
              </Text>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Расход в месяц</Text>
                <Text style={styles.statValue}>
                  {formatMoney(financial.monthlyBurnRate)}
                </Text>
              </View>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Ты откладываешь</Text>
                <Text
                  style={[
                    styles.statValue,
                    {
                      color:
                        financial.savingsRate < 0
                          ? c.danger
                          : financial.savingsRate < 10
                          ? '#F59E0B'
                          : c.success,
                    },
                  ]}
                >
                  {financial.savingsRate}%
                </Text>
              </View>

              {/* Top 3 money drains */}
              <Text style={styles.subHeading}>Куда уходят деньги</Text>
              {financial.topDrains.map((drain, idx) => (
                <View key={idx} style={styles.drainRow}>
                  <View style={styles.drainLabelRow}>
                    <Text style={styles.drainLabel}>{drain.label}</Text>
                    <Text style={styles.drainAmount}>
                      {formatMoney(drain.amount)}
                    </Text>
                  </View>
                  <AnimatedProgressBar
                    progress={drain.percent}
                    height={6}
                    color={drain.color}
                    style={styles.drainBar}
                  />
                </View>
              ))}

              {/* Apartment timeline */}
              <View style={styles.insightBox}>
                <Feather name="home" size={16} color={c.textSecondary} />
                <Text style={styles.insightText}>
                  {financial.apartmentTimeline}
                </Text>
              </View>

              {/* Days until broke */}
              {financial.daysUntilBroke !== null ? (
                <View
                  style={[
                    styles.insightBox,
                    { backgroundColor: c.danger + '15' },
                  ]}
                >
                  <Feather name="alert-triangle" size={16} color={c.danger} />
                  <Text style={[styles.insightText, { color: c.danger }]}>
                    До нуля: {financial.daysUntilBroke} дней
                  </Text>
                </View>
              ) : null}

              {/* Daily life cost */}
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Стоимость твоей жизни</Text>
                <Text style={styles.statValue}>
                  {formatMoney(financial.dailyLifeCost)}/день
                </Text>
              </View>

              {/* Bad decisions */}
              {financial.badDecisions.length > 0 ? (
                <View style={styles.warningBlock}>
                  <Text style={styles.warningTitle}>Плохие решения</Text>
                  {financial.badDecisions.map((decision, idx) => (
                    <Text key={idx} style={styles.warningItem}>
                      {'\u2022'} {decision}
                    </Text>
                  ))}
                </View>
              ) : null}

              {/* Cash flow gaps */}
              {financial.cashFlowGaps.length > 0 ? (
                <View style={styles.warningBlock}>
                  <Text style={styles.warningTitle}>Кассовые разрывы</Text>
                  {financial.cashFlowGaps.map((gap, idx) => (
                    <Text key={idx} style={styles.warningItem}>
                      {'\u2022'} {gap}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Card>
          </AnimatedPress>
        </FadeInView>

        {/* Health Truth */}
        <FadeInView delay={200}>
          <AnimatedPress>
            <Card style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>
                {'🏃'} Правда о здоровье
              </Text>

              {/* Sleep */}
              <View style={styles.healthRow}>
                <SeverityDot severity={health.sleepSeverity} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.statLabel}>
                    Сон: {health.sleepHours} ч/ночь
                  </Text>
                  <Text
                    style={[
                      styles.healthVerdict,
                      { color: severityColor(health.sleepSeverity, c) },
                    ]}
                  >
                    {health.sleepVerdict}
                  </Text>
                </View>
              </View>

              {/* Steps */}
              <View style={styles.healthRow}>
                <SeverityDot severity={health.stepsSeverity} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.statLabel}>
                    Шаги: {health.stepsPerDay.toLocaleString('ru-RU')}/день
                  </Text>
                  <Text
                    style={[
                      styles.healthVerdict,
                      { color: severityColor(health.stepsSeverity, c) },
                    ]}
                  >
                    {health.stepsVerdict}
                  </Text>
                </View>
              </View>

              {/* Exercise */}
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Тренировки</Text>
                <Text style={styles.statValue}>
                  {health.exerciseFrequency}
                </Text>
              </View>

              {/* Burnout risk */}
              <View style={styles.burnoutBlock}>
                <View style={styles.burnoutHeader}>
                  <Text style={styles.statLabel}>Риск выгорания</Text>
                  <Text
                    style={[
                      styles.burnoutPercent,
                      {
                        color:
                          health.burnoutRisk > 70
                            ? c.danger
                            : health.burnoutRisk > 40
                            ? '#F59E0B'
                            : c.success,
                      },
                    ]}
                  >
                    {health.burnoutRisk}%
                  </Text>
                </View>
                <AnimatedProgressBar
                  progress={health.burnoutRisk}
                  height={8}
                  color={
                    health.burnoutRisk > 70
                      ? c.danger
                      : health.burnoutRisk > 40
                      ? '#F59E0B'
                      : c.success
                  }
                />
              </View>

              {/* Body warnings */}
              {health.bodyWarnings.length > 0 ? (
                <View style={styles.warningBlock}>
                  <Text style={styles.warningTitle}>Сигналы тела</Text>
                  {health.bodyWarnings.map((w, idx) => (
                    <Text key={idx} style={styles.warningItem}>
                      {'\u2022'} {w}
                    </Text>
                  ))}
                </View>
              ) : null}

              {/* Mental health */}
              {health.mentalHealthFlags.length > 0 ? (
                <View style={styles.warningBlock}>
                  <Text style={styles.warningTitle}>Ментальное здоровье</Text>
                  {health.mentalHealthFlags.map((f, idx) => (
                    <Text key={idx} style={styles.warningItem}>
                      {'\u2022'} {f}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Card>
          </AnimatedPress>
        </FadeInView>

        {/* Life Progress */}
        <FadeInView delay={300}>
          <AnimatedPress>
            <Card style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>
                {'📊'} Правда о прогрессе
              </Text>

              {/* Goals visual */}
              <View style={styles.goalsRow}>
                <View style={styles.goalBox}>
                  <Text style={[styles.goalNumber, { color: c.success }]}>
                    {progress.goalsOnTrack}
                  </Text>
                  <Text style={styles.goalLabel}>В графике</Text>
                </View>
                <View style={styles.goalDivider} />
                <View style={styles.goalBox}>
                  <Text style={[styles.goalNumber, { color: c.danger }]}>
                    {progress.goalsBehind}
                  </Text>
                  <Text style={styles.goalLabel}>Отстают</Text>
                </View>
                <View style={styles.goalDivider} />
                <View style={styles.goalBox}>
                  <Text style={[styles.goalNumber, { color: c.textSecondary }]}>
                    {progress.goalsTotal}
                  </Text>
                  <Text style={styles.goalLabel}>Всего</Text>
                </View>
              </View>

              {/* Habit consistency */}
              <View style={styles.consistencyBlock}>
                <View style={styles.burnoutHeader}>
                  <Text style={styles.statLabel}>Стабильность привычек</Text>
                  <Text
                    style={[
                      styles.burnoutPercent,
                      {
                        color:
                          progress.habitConsistency > 70
                            ? c.success
                            : progress.habitConsistency > 40
                            ? '#F59E0B'
                            : c.danger,
                      },
                    ]}
                  >
                    {progress.habitConsistency}%
                  </Text>
                </View>
                <AnimatedProgressBar
                  progress={progress.habitConsistency}
                  height={8}
                  color={
                    progress.habitConsistency > 70
                      ? c.success
                      : progress.habitConsistency > 40
                      ? '#F59E0B'
                      : c.danger
                  }
                />
              </View>

              {/* Worst habits */}
              {progress.worstHabits.length > 0 ? (
                <View style={styles.worstBlock}>
                  <Text style={styles.warningTitle}>
                    Самые слабые привычки
                  </Text>
                  {progress.worstHabits.map((h, idx) => (
                    <View key={idx} style={styles.worstRow}>
                      <Text style={styles.worstName}>{h.name}</Text>
                      <Text
                        style={[
                          styles.worstPercent,
                          { color: h.completion < 30 ? c.danger : '#F59E0B' },
                        ]}
                      >
                        {h.completion}%
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Productivity trend */}
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Тренд продуктивности</Text>
                <Text
                  style={[
                    styles.trendText,
                    { color: trendColor(progress.productivityTrend, c) },
                  ]}
                >
                  {trendIcon(progress.productivityTrend)}{' '}
                  {progress.productivityTrend === 'up'
                    ? 'Растёт'
                    : progress.productivityTrend === 'down'
                    ? 'Падает'
                    : 'Стабильно'}
                </Text>
              </View>

              {/* Streak */}
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Текущая серия</Text>
                <Text style={styles.streakText}>
                  {progress.currentStreak} дней
                </Text>
              </View>
            </Card>
          </AnimatedPress>
        </FadeInView>

        {/* AI Verdict */}
        <FadeInView delay={400}>
          <AnimatedPress onPress={toggleVerdict}>
            <Card
              style={[
                styles.sectionCard,
                { borderColor: c.primary, borderWidth: 1.5 },
              ]}
            >
              <View style={styles.verdictHeader}>
                <Text style={styles.sectionTitle}>
                  {'🤖'} Вердикт LifeOS
                </Text>
                <Feather
                  name={verdictExpanded ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={c.textSecondary}
                />
              </View>

              <Text
                style={styles.verdictText}
                numberOfLines={verdictExpanded ? undefined : 4}
              >
                {aiVerdict}
              </Text>

              {verdictExpanded ? (
                <TouchableOpacity
                  onPress={toggleExit}
                  style={styles.actionButton}
                  activeOpacity={0.7}
                >
                  <Feather name="compass" size={16} color={c.primary} />
                  <Text style={styles.actionButtonText}>
                    {exitVisible ? 'Скрыть выходы' : 'Что делать?'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </Card>
          </AnimatedPress>
        </FadeInView>

        {/* Exit Strategies */}
        {exitVisible && exitStrategies.length > 0 ? (
          <FadeInView delay={100}>
            <Card style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>
                {'🚪'} Выходы из ситуации
              </Text>

              {exitStrategies.map((strategy) => (
                <View key={strategy.id} style={styles.strategyRow}>
                  <View style={styles.strategyTextBlock}>
                    <View style={styles.strategyBullet} />
                    <Text style={styles.strategyText}>{strategy.text}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleCreateAction(strategy)}
                    disabled={creatingAction === strategy.id}
                    style={[
                      styles.strategyButton,
                      {
                        backgroundColor:
                          strategy.actionType === 'task'
                            ? c.primary + '20'
                            : c.success + '20',
                      },
                    ]}
                    activeOpacity={0.7}
                  >
                    <Feather
                      name={
                        strategy.actionType === 'task'
                          ? 'check-square'
                          : 'repeat'
                      }
                      size={14}
                      color={
                        strategy.actionType === 'task' ? c.primary : c.success
                      }
                    />
                    <Text
                      style={[
                        styles.strategyButtonText,
                        {
                          color:
                            strategy.actionType === 'task'
                              ? c.primary
                              : c.success,
                        },
                      ]}
                    >
                      {creatingAction === strategy.id
                        ? '...'
                        : strategy.actionType === 'task'
                        ? 'Создать задачу'
                        : 'Создать привычку'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </Card>
          </FadeInView>
        ) : null}

        {/* Bottom spacer */}
        <View style={{ height: spacing.xl * 2 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- Styles ----------

function createStyles(c: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: spacing.xl * 3,
    },

    // Header
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    backButton: {
      marginRight: spacing.md,
      padding: spacing.xs,
    },
    headerTitle: {
      color: c.text,
      fontSize: fontSize.xl,
      fontWeight: '800',
    },
    headerDate: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      marginTop: 2,
    },

    // Section card
    sectionCard: {
      marginBottom: spacing.md,
    },
    sectionTitle: {
      color: c.text,
      fontSize: fontSize.lg,
      fontWeight: '700',
      marginBottom: spacing.md,
    },
    subHeading: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: '600',
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },

    // Stat rows
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    statLabel: {
      color: c.textSecondary,
      fontSize: fontSize.md,
    },
    statValue: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '700',
    },

    // Drains
    drainRow: {
      marginBottom: spacing.sm,
    },
    drainLabelRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    drainLabel: {
      color: c.text,
      fontSize: fontSize.sm,
    },
    drainAmount: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
    },
    drainBar: {
      marginTop: 2,
    },

    // Insight box
    insightBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.sm,
      padding: spacing.sm,
      marginTop: spacing.sm,
      gap: spacing.sm,
    },
    insightText: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      flex: 1,
    },

    // Warning block
    warningBlock: {
      marginTop: spacing.md,
      backgroundColor: c.danger + '10',
      borderRadius: borderRadius.sm,
      padding: spacing.sm,
    },
    warningTitle: {
      color: c.danger,
      fontSize: fontSize.sm,
      fontWeight: '700',
      marginBottom: spacing.xs,
    },
    warningItem: {
      color: c.danger,
      fontSize: fontSize.sm,
      lineHeight: 20,
      opacity: 0.85,
    },

    // Health
    healthRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    healthVerdict: {
      fontSize: fontSize.sm,
      marginTop: 2,
    },

    // Burnout
    burnoutBlock: {
      marginTop: spacing.md,
    },
    burnoutHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.xs,
    },
    burnoutPercent: {
      fontSize: fontSize.md,
      fontWeight: '700',
    },

    // Goals
    goalsRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      paddingVertical: spacing.md,
      marginBottom: spacing.sm,
    },
    goalBox: {
      alignItems: 'center',
      flex: 1,
    },
    goalNumber: {
      fontSize: fontSize.xxl,
      fontWeight: '800',
    },
    goalLabel: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      marginTop: 2,
    },
    goalDivider: {
      width: 1,
      height: 40,
      backgroundColor: c.border,
    },

    // Consistency
    consistencyBlock: {
      marginBottom: spacing.md,
    },

    // Worst habits
    worstBlock: {
      marginTop: spacing.sm,
      backgroundColor: c.danger + '08',
      borderRadius: borderRadius.sm,
      padding: spacing.sm,
    },
    worstRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
    },
    worstName: {
      color: c.text,
      fontSize: fontSize.sm,
      flex: 1,
    },
    worstPercent: {
      fontSize: fontSize.sm,
      fontWeight: '700',
    },

    // Trend
    trendText: {
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    streakText: {
      color: c.primary,
      fontSize: fontSize.md,
      fontWeight: '700',
    },

    // Verdict
    verdictHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    verdictText: {
      color: c.text,
      fontSize: fontSize.md,
      lineHeight: 24,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      marginTop: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      backgroundColor: c.primary + '15',
      borderRadius: borderRadius.md,
      gap: spacing.xs,
    },
    actionButtonText: {
      color: c.primary,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },

    // Exit strategies
    strategyRow: {
      marginBottom: spacing.md,
    },
    strategyTextBlock: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: spacing.sm,
    },
    strategyBullet: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.primary,
      marginTop: 7,
      marginRight: spacing.sm,
    },
    strategyText: {
      color: c.text,
      fontSize: fontSize.md,
      lineHeight: 22,
      flex: 1,
    },
    strategyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.sm,
      gap: spacing.xs,
      marginLeft: spacing.md + 6,
    },
    strategyButtonText: {
      fontSize: fontSize.sm,
      fontWeight: '600',
    },

    // Empty / centered
    centered: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xl * 2,
    },
    emptyIcon: {
      fontSize: 48,
      marginBottom: spacing.md,
    },
    emptyText: {
      color: c.textSecondary,
      fontSize: fontSize.md,
      textAlign: 'center',
      paddingHorizontal: spacing.lg,
    },
  });
}
