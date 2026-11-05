import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { borderRadius, fontSize, spacing } from '@/constants';
import { useDealStore } from '@/stores/deal-store';
import { useChatStore } from '@/stores/chat-store';
import { useScheduleStore } from '@/stores/schedule-store';
import { groupDeals } from '@/services/deals';
import { civilToday, groupTitle } from '@/services/deals-view';
import { DealRow } from '@/components/deals/deal-row';
import { DealSheet } from '@/components/deals/deal-sheet';
import { NewDealSheet } from '@/components/deals/new-deal-sheet';
import { PlanBar } from '@/components/deals/plan-bar';
import { PlanSheet } from '@/components/deals/plan-sheet';

/**
 * Панель «Сделки» (спека 2026-11-05-deals): план месяца → открытые сделки по стадиям →
 * «Закрытые» свёрнуто. Перечитывается после ответа робота (мог завести/сдвинуть сделку голосом).
 */
export default function DealsScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const deals = useDealStore((s) => s.deals);
  const closed = useDealStore((s) => s.closed);
  const plan = useDealStore((s) => s.plan);
  const planKnown = useDealStore((s) => s.planKnown);
  const loaded = useDealStore((s) => s.loaded);
  const loadError = useDealStore((s) => s.loadError);
  const isLoading = useDealStore((s) => s.isLoading);
  const closedLoaded = useDealStore((s) => s.closedLoaded);
  const closedError = useDealStore((s) => s.closedError);
  const fetch = useDealStore((s) => s.fetch);
  const fetchClosed = useDealStore((s) => s.fetchClosed);
  const latestReplyId = useChatStore((s) => s.messages[0]?.id);
  const scheduleRevision = useScheduleStore((s) => s.revision);

  const [openId, setOpenId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);

  useEffect(() => {
    void fetch();
  }, [fetch, latestReplyId, scheduleRevision]);
  useEffect(() => {
    if (showClosed) void fetchClosed();
  }, [showClosed, fetchClosed, latestReplyId]);

  const groups = useMemo(() => groupDeals(deals), [deals]);
  // Карточка ищет сделку по id и в открытых, и в закрытых: после «Выиграна» она остаётся на экране.
  const openDeal = useMemo(
    () => (openId ? (deals.find((d) => d.id === openId) ?? closed.find((d) => d.id === openId) ?? null) : null),
    [openId, deals, closed],
  );
  const today = civilToday();

  const closeDeal = useCallback(() => setOpenId(null), []);
  const toggleClosed = useCallback(() => setShowClosed((v) => !v), []);
  const openAdd = useCallback(() => setAdding(true), []);
  const closeAdd = useCallback(() => setAdding(false), []);
  const openPlan = useCallback(() => setEditingPlan(true), []);
  const closePlan = useCallback(() => setEditingPlan(false), []);
  const retry = useCallback(() => void fetch(), [fetch]);
  const retryClosed = useCallback(() => void fetchClosed(), [fetchClosed]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <PlanBar plan={plan} planKnown={planKnown} onPress={openPlan} />
        {/* В потоке, а не плавающей кнопкой: плавающая перекрывала нижние сделки. */}
        <Pressable onPress={openAdd} style={styles.addPill} accessibilityRole="button" accessibilityLabel="Добавить сделку">
          <Text style={styles.addPillText}>+ Новая сделка</Text>
        </Pressable>
        {loadError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Не удалось загрузить сделки — проверь интернет</Text>
            <Pressable onPress={retry} disabled={isLoading} style={styles.retry} accessibilityRole="button">
              <Text style={styles.retryText}>{isLoading ? 'Загружаю…' : 'Повторить'}</Text>
            </Pressable>
          </View>
        ) : null}
        {!loaded ? (
          // Первая загрузка: пустой список — ещё не «сделок нет».
          loadError ? null : <ActivityIndicator style={styles.spinner} color={c.primary} />
        ) : groups.length === 0 ? (
          <Text style={styles.empty}>Открытых сделок нет. Скажи роботу «Ахмет хочет оборудование на 2 млн» — заведу. Или нажми «+ Новая сделка».</Text>
        ) : (
          groups.map((g) => (
            <View key={g.stage} style={styles.group}>
              <Text style={styles.groupTitle}>{groupTitle(g)}</Text>
              {g.deals.map((d) => (
                <DealRow key={d.id} deal={d} today={today} onPress={setOpenId} />
              ))}
            </View>
          ))
        )}
        <Pressable onPress={toggleClosed} style={styles.closedToggle} accessibilityRole="button">
          <Text style={styles.groupTitle}>{`${showClosed ? '▾' : '▸'} Закрытые`}</Text>
        </Pressable>
        {showClosed && closedError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Не удалось загрузить закрытые — проверь интернет</Text>
            <Pressable onPress={retryClosed} style={styles.retry} accessibilityRole="button">
              <Text style={styles.retryText}>Повторить</Text>
            </Pressable>
          </View>
        ) : null}
        {!showClosed ? null : !closedLoaded ? (
          closedError ? null : <ActivityIndicator style={styles.spinner} color={c.primary} />
        ) : closed.length === 0 ? (
          <Text style={styles.closedEmpty}>За 90 дней закрытых сделок нет.</Text>
        ) : (
          closed.map((d) => <DealRow key={d.id} deal={d} today={today} onPress={setOpenId} />)
        )}
      </ScrollView>
      <DealSheet deal={openDeal} onClose={closeDeal} />
      <NewDealSheet visible={adding} onClose={closeAdd} />
      <PlanSheet visible={editingPlan} current={plan?.plan ?? null} onClose={closePlan} />
    </View>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    empty: { color: c.textSecondary, fontSize: fontSize.md, textAlign: 'center', marginVertical: spacing.xl },
    group: { marginBottom: spacing.lg },
    groupTitle: { color: c.textSecondary, fontSize: fontSize.sm, fontWeight: '600', marginBottom: spacing.sm },
    closedToggle: { paddingVertical: spacing.sm },
    closedEmpty: { color: c.textSecondary, fontSize: fontSize.sm },
    spinner: { marginVertical: spacing.xl },
    errorBox: { padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.md, backgroundColor: c.surface },
    errorText: { color: c.danger, fontSize: fontSize.sm, textAlign: 'center' },
    retry: { alignSelf: 'center', marginTop: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
    retryText: { color: c.primary, fontSize: fontSize.md, fontWeight: '600' },
    addPill: {
      alignSelf: 'flex-start',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.xl,
      marginBottom: spacing.lg,
      backgroundColor: c.surface,
    },
    addPillText: { color: c.primary, fontSize: fontSize.md, fontWeight: '600' },
  });
}
