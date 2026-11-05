import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <PlanBar plan={plan} onPress={openPlan} />
        {groups.length === 0 ? (
          <Text style={styles.empty}>Открытых сделок нет. Скажи роботу «Ахмет хочет оборудование на 2 млн» — заведу. Или нажми «+».</Text>
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
        {showClosed
          ? closed.length === 0
            ? <Text style={styles.closedEmpty}>За 90 дней закрытых сделок нет.</Text>
            : closed.map((d) => <DealRow key={d.id} deal={d} today={today} onPress={setOpenId} />)
          : null}
      </ScrollView>
      {/* «+» слева: справа/внизу живёт микрофон. */}
      <Pressable onPress={openAdd} style={styles.fab} accessibilityRole="button" accessibilityLabel="Добавить сделку">
        <Text style={styles.fabText}>+</Text>
      </Pressable>
      <DealSheet deal={openDeal} onClose={closeDeal} />
      <NewDealSheet visible={adding} onClose={closeAdd} />
      <PlanSheet visible={editingPlan} current={plan?.plan ?? null} onClose={closePlan} />
    </View>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: spacing.md, paddingBottom: spacing.xl * 3 },
    empty: { color: c.textSecondary, fontSize: fontSize.md, textAlign: 'center', marginVertical: spacing.xl },
    group: { marginBottom: spacing.lg },
    groupTitle: { color: c.textSecondary, fontSize: fontSize.sm, fontWeight: '600', marginBottom: spacing.sm },
    closedToggle: { paddingVertical: spacing.sm },
    closedEmpty: { color: c.textSecondary, fontSize: fontSize.sm },
    fab: {
      position: 'absolute',
      left: spacing.lg,
      bottom: spacing.xl,
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.primary,
    },
    fabText: { color: '#FFFFFF', fontSize: 28, fontWeight: '700' },
  });
}
