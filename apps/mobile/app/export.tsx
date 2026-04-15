import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  Share,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { cacheDirectory, writeAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { Card } from '@/components/ui';
import { FadeInView } from '@/components/ui/fade-in-view';
import { AnimatedPress } from '@/components/ui/animated-press';
import { hapticSuccess, hapticError } from '@/services/haptics';
import { api } from '@/services/api';
import type { Theme } from '@/constants/themes';

const CSV_MODULES = [
  { key: 'finance', label: 'Финансы', icon: '💰', desc: 'Все расходы и доходы' },
  { key: 'habits', label: 'Привычки', icon: '🏃', desc: 'Привычки и логи выполнения' },
  { key: 'tasks', label: 'Задачи', icon: '📋', desc: 'Все задачи с деталями' },
] as const;

const REPORT_PERIODS = [
  { key: 'month', label: 'За месяц', icon: '📅' },
  { key: 'year', label: 'За год', icon: '📊' },
] as const;

export default function ExportScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const handleExportCsv = useCallback(async (module: string) => {
    setLoadingKey(`csv_${module}`);
    try {
      const response = await api.postRaw(`/export/csv/${module}`);
      if (!response.ok) throw new Error('Ошибка экспорта');
      const csvText = await response.text();

      const filePath = `${cacheDirectory}${module}_export.csv`;
      await writeAsStringAsync(filePath, csvText);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'text/csv',
          UTI: 'public.comma-separated-values-text',
        });
      }
      hapticSuccess();
    } catch (err) {
      hapticError();
      Alert.alert('Ошибка', 'Не удалось экспортировать данные');
    } finally {
      setLoadingKey(null);
    }
  }, []);

  const handleExportReport = useCallback(async (period: string) => {
    setLoadingKey(`report_${period}`);
    try {
      const data = await api.post<{ reportData: any; message: string }>('/export/pdf/report', { period });
      const report = data.reportData;

      const text = [
        `📊 Отчёт LifeOS (${period === 'month' ? 'месяц' : 'год'})`,
        `📅 ${report.startDate} — ${report.endDate}`,
        '',
        `✅ Задачи: ${report.tasks.completed}/${report.tasks.total} (${report.tasks.completionRate}%)`,
        `🏃 Привычки: ${report.habits.totalCompletions} выполнений (${report.habits.activeCount} активных)`,
        '',
        `💰 Доходы: ${formatMoney(report.finance.totalIncomes)}`,
        `💸 Расходы: ${formatMoney(report.finance.totalExpenses)}`,
        `📈 Баланс: ${formatMoney(report.finance.balance)}`,
        '',
        '🏆 Топ расходов:',
        ...report.finance.topCategories.map(
          (cat: { category: string; amount: number }, i: number) =>
            `  ${i + 1}. ${cat.category}: ${formatMoney(cat.amount)}`
        ),
      ].join('\n');

      await Share.share({
        message: text,
        title: 'Отчёт LifeOS',
      });
      hapticSuccess();
    } catch (err) {
      hapticError();
      Alert.alert('Ошибка', 'Не удалось создать отчёт');
    } finally {
      setLoadingKey(null);
    }
  }, []);

  const handleShareStory = useCallback(async () => {
    setLoadingKey('story');
    try {
      const data = await api.post<{ stats: any; title: string; style: string }>('/export/story', {});
      const stats = data.stats;

      const storyText = [
        '🚀 Мой прогресс в LifeOS',
        '',
        `✅ Задачи сегодня: ${stats.tasksCompletedToday}/${stats.tasksTotalToday}`,
        `🏃 Привычки: ${stats.habitsCompletedToday}/${stats.habitsTotalToday}`,
        `🔥 Серия: ${stats.habitsStreak} дней`,
        `👟 Шаги: ${stats.stepsToday.toLocaleString()}`,
        '',
        `📊 За неделю: ${stats.tasksCompletedWeek}/${stats.tasksTotalWeek} задач`,
        '',
        '#LifeOS #Productivity',
      ].join('\n');

      await Share.share({
        message: storyText,
        title: 'Мой прогресс в LifeOS',
      });
      hapticSuccess();
    } catch (err) {
      hapticError();
      Alert.alert('Ошибка', 'Не удалось создать историю');
    } finally {
      setLoadingKey(null);
    }
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Экспорт данных</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* CSV Export */}
        <FadeInView delay={0}>
          <Text style={styles.sectionTitle}>📁 Экспорт в CSV</Text>
          <Text style={styles.sectionDesc}>
            Выгрузите данные в формате CSV для Excel или Google Sheets
          </Text>
        </FadeInView>

        {CSV_MODULES.map((mod, idx) => (
          <FadeInView key={mod.key} delay={(idx + 1) * 80}>
            <AnimatedPress onPress={() => handleExportCsv(mod.key)}>
              <Card style={styles.exportCard}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardIcon}>{mod.icon}</Text>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardLabel}>{mod.label}</Text>
                    <Text style={styles.cardDesc}>{mod.desc}</Text>
                  </View>
                  {loadingKey === `csv_${mod.key}` ? (
                    <ActivityIndicator size="small" color={c.primary} />
                  ) : (
                    <Feather name="download" size={20} color={c.primary} />
                  )}
                </View>
              </Card>
            </AnimatedPress>
          </FadeInView>
        ))}

        {/* Report */}
        <FadeInView delay={320}>
          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>📊 Отчёт</Text>
          <Text style={styles.sectionDesc}>
            Сводный текстовый отчёт с ключевыми метриками
          </Text>
        </FadeInView>

        {REPORT_PERIODS.map((period, idx) => (
          <FadeInView key={period.key} delay={400 + idx * 80}>
            <AnimatedPress onPress={() => handleExportReport(period.key)}>
              <Card style={styles.exportCard}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardIcon}>{period.icon}</Text>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardLabel}>{period.label}</Text>
                  </View>
                  {loadingKey === `report_${period.key}` ? (
                    <ActivityIndicator size="small" color={c.primary} />
                  ) : (
                    <Feather name="share-2" size={20} color={c.primary} />
                  )}
                </View>
              </Card>
            </AnimatedPress>
          </FadeInView>
        ))}

        {/* Instagram Story */}
        <FadeInView delay={560}>
          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>📸 Поделиться</Text>
          <Text style={styles.sectionDesc}>
            Поделитесь прогрессом в соцсетях
          </Text>
        </FadeInView>

        <FadeInView delay={640}>
          <AnimatedPress onPress={handleShareStory}>
            <Card style={[styles.exportCard, styles.storyCard]}>
              <View style={styles.cardRow}>
                <Text style={styles.cardIcon}>🚀</Text>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardLabel}>Instagram Story</Text>
                  <Text style={styles.cardDesc}>Ваш прогресс за сегодня</Text>
                </View>
                {loadingKey === 'story' ? (
                  <ActivityIndicator size="small" color="#E1306C" />
                ) : (
                  <Feather name="instagram" size={20} color="#E1306C" />
                )}
              </View>
            </Card>
          </AnimatedPress>
        </FadeInView>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatMoney(amount: number): string {
  return `${amount.toLocaleString('ru-RU')} ₸`;
}

function createStyles(c: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    backButton: { padding: spacing.xs },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: c.text },
    content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
    sectionTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: c.text,
      marginBottom: 4,
    },
    sectionDesc: {
      fontSize: fontSize.sm,
      color: c.textMuted,
      marginBottom: spacing.md,
    },
    exportCard: {
      marginBottom: spacing.sm,
      padding: spacing.md,
    },
    storyCard: {
      borderWidth: 1,
      borderColor: 'rgba(225, 48, 108, 0.3)',
    },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    cardIcon: { fontSize: 28 },
    cardInfo: { flex: 1 },
    cardLabel: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
    },
    cardDesc: {
      fontSize: fontSize.xs,
      color: c.textMuted,
      marginTop: 2,
    },
  });
}
