import React, { useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useSubscriptionStore } from '@/stores/subscription-store';
import type { Theme } from '@/constants/themes';

interface FeatureRow {
  label: string;
  free: boolean | string;
  pro: boolean | string;
}

const FEATURES: FeatureRow[] = [
  { label: 'Безлимитные задачи и привычки', free: true, pro: true },
  { label: 'Календарь + синхронизация', free: true, pro: true },
  { label: 'Финансовый трекер', free: true, pro: true },
  { label: 'Дневник самочувствия', free: true, pro: true },
  { label: 'Питомец', free: true, pro: true },
  { label: 'Офлайн-режим', free: true, pro: true },
  { label: 'Голосовые команды', free: '3/день', pro: '∞' },
  { label: 'JARVIS AI-ассистент', free: false, pro: true },
  { label: 'AI-приоритизация задач', free: false, pro: true },
  { label: 'Kanban + Gantt', free: false, pro: true },
  { label: 'Зависимости задач', free: false, pro: true },
  { label: 'Все темы оформления', free: '1 тема', pro: '6 тем' },
  { label: 'Расширенная аналитика', free: false, pro: true },
  { label: 'Экспорт PDF/CSV', free: false, pro: true },
  { label: 'Общие пространства', free: 'до 3', pro: 'до 10' },
  { label: 'Все костюмы питомца', free: false, pro: true },
];

export default function SubscriptionScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
  const { tier, loadSubscription } = useSubscriptionStore();

  useEffect(() => {
    loadSubscription();
  }, [loadSubscription]);

  const isPro = tier === 'pro';

  const handleUpgrade = () => {
    Alert.alert(
      'PRO подписка',
      'Оплата будет доступна после релиза в App Store / Google Play.',
      [{ text: 'OK' }],
    );
  };

  const handleRestore = () => {
    Alert.alert('Восстановление', 'Функция будет доступна после подключения оплаты.', [
      { text: 'OK' },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Подписка</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Current plan badge */}
        <View style={[styles.planBadge, isPro && styles.planBadgePro]}>
          <Feather name={isPro ? 'star' : 'user'} size={20} color={isPro ? '#F59E0B' : c.textMuted} />
          <Text style={[styles.planText, isPro && styles.planTextPro]}>
            {isPro ? 'PRO' : 'Бесплатный план'}
          </Text>
        </View>

        {/* Feature comparison */}
        <View style={styles.table}>
          {/* Header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, { flex: 1 }]}>Функция</Text>
            <Text style={[styles.tableHeaderText, styles.colHeader]}>Free</Text>
            <Text style={[styles.tableHeaderText, styles.colHeader, styles.colHeaderPro]}>PRO</Text>
          </View>

          {/* Rows */}
          {FEATURES.map((f, i) => (
            <View key={i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
              <Text style={styles.featureLabel}>{f.label}</Text>
              <View style={styles.featureCol}>
                {typeof f.free === 'boolean' ? (
                  f.free ? (
                    <Feather name="check" size={16} color={c.success} />
                  ) : (
                    <Feather name="x" size={16} color={c.textMuted} />
                  )
                ) : (
                  <Text style={styles.featureText}>{f.free}</Text>
                )}
              </View>
              <View style={styles.featureCol}>
                {typeof f.pro === 'boolean' ? (
                  f.pro ? (
                    <Feather name="check" size={16} color={c.primary} />
                  ) : (
                    <Feather name="x" size={16} color={c.textMuted} />
                  )
                ) : (
                  <Text style={[styles.featureText, { color: c.primary }]}>{f.pro}</Text>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* Upgrade button */}
        {!isPro && (
          <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgrade} activeOpacity={0.8}>
            <Feather name="zap" size={20} color="#FFF" />
            <Text style={styles.upgradeText}>Перейти на PRO</Text>
          </TouchableOpacity>
        )}

        {isPro && (
          <View style={styles.proActive}>
            <Feather name="check-circle" size={24} color={c.success} />
            <Text style={styles.proActiveText}>PRO подписка активна</Text>
          </View>
        )}

        {/* Restore */}
        <TouchableOpacity style={styles.restoreButton} onPress={handleRestore}>
          <Text style={styles.restoreText}>Восстановить покупку</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(c: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
    },
    backButton: { padding: spacing.xs },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: c.text },
    content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
    planBadge: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surface, borderRadius: borderRadius.md,
      padding: spacing.md, marginBottom: spacing.lg, alignSelf: 'center',
      paddingHorizontal: spacing.lg,
    },
    planBadgePro: { backgroundColor: '#F59E0B20', borderWidth: 1, borderColor: '#F59E0B40' },
    planText: { fontSize: fontSize.md, fontWeight: '600', color: c.textSecondary },
    planTextPro: { color: '#F59E0B' },
    table: { borderRadius: borderRadius.md, overflow: 'hidden', marginBottom: spacing.lg },
    tableHeader: {
      flexDirection: 'row', backgroundColor: c.surface, paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
    },
    tableHeaderText: { fontSize: fontSize.xs, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase' },
    colHeader: { width: 50, textAlign: 'center' },
    colHeaderPro: { color: c.primary },
    tableRow: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
    },
    tableRowAlt: { backgroundColor: `${c.surface}50` },
    featureLabel: { flex: 1, fontSize: fontSize.xs, color: c.text, lineHeight: 16 },
    featureCol: { width: 50, alignItems: 'center' },
    featureText: { fontSize: fontSize.xs, color: c.textSecondary, fontWeight: '500' },
    upgradeButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
      backgroundColor: c.primary, borderRadius: borderRadius.md, padding: spacing.md,
      marginBottom: spacing.md,
    },
    upgradeText: { fontSize: fontSize.md, fontWeight: '700', color: '#FFF' },
    proActive: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
      padding: spacing.md,
    },
    proActiveText: { fontSize: fontSize.md, fontWeight: '600', color: c.success },
    restoreButton: { alignItems: 'center', padding: spacing.md },
    restoreText: { fontSize: fontSize.sm, color: c.textMuted, textDecorationLine: 'underline' },
  });
}
