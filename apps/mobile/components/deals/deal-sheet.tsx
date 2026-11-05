import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/use-colors';
import { borderRadius, fontSize, spacing } from '@/constants';
import { STAGE_LABEL, fmtMoney, isOpenStage, neighborStages, type Deal, type DealEvent, type DealStage } from '@/services/deals';
import { LOST_REASONS, canRecordIncome, dealHead, eventLine, reopenStage, stepLine } from '@/services/deals-view';
import { dealErrorText, useDealIncome } from '@/hooks/use-deal-income';
import { useDealStore } from '@/stores/deal-store';
import { StageButton } from '@/components/deals/stage-button';

/**
 * Карточка сделки: стадия (кнопки соседних), «Выиграна» → «Записать доход N ₸?»,
 * «Проиграна» (причина), шаг, история. Закрытую можно вернуть в работу.
 */
export const DealSheet = memo(function DealSheet({ deal, onClose }: { deal: Deal | null; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(c), [c]);
  const moveStage = useDealStore((s) => s.moveStage);
  const fetchOne = useDealStore((s) => s.fetchOne);
  const { offer, record } = useDealIncome();
  const [events, setEvents] = useState<DealEvent[]>([]);
  const [busy, setBusy] = useState(false);

  const dealId = deal?.id ?? null;
  const updatedAt = deal?.updatedAt ?? null;
  useEffect(() => {
    let alive = true;
    setEvents([]);
    if (dealId) {
      void fetchOne(dealId).then((d) => {
        if (alive) setEvents(d?.events ?? []);
      });
    }
    return () => {
      alive = false;
    };
  }, [dealId, updatedAt, fetchOne]);

  const onMove = useCallback(
    async (stage: DealStage, lostReason?: string) => {
      if (!deal) return;
      setBusy(true);
      try {
        const r = await moveStage(deal.id, stage, lostReason);
        if (r.incomeOffer && r.deal.amount != null) {
          // Карточка открыта, пока идёт вопрос про доход: Alert поверх закрывающейся модалки на iOS теряется.
          offer(r.deal, onClose);
          return;
        }
        onClose();
      } catch (err) {
        Alert.alert('Не получилось', dealErrorText(err));
      } finally {
        setBusy(false);
      }
    },
    [deal, moveStage, offer, onClose],
  );

  const onLost = useCallback(() => {
    Alert.alert('Почему проиграна?', undefined, [
      ...LOST_REASONS.map((reason) => ({ text: reason[0].toUpperCase() + reason.slice(1), onPress: () => void onMove('lost', reason) })),
      { text: 'Без причины', onPress: () => void onMove('lost') },
      { text: 'Отмена', style: 'cancel' as const },
    ]);
  }, [onMove]);

  const onRecord = useCallback(() => {
    if (deal) record(deal, onClose);
  }, [deal, record, onClose]);

  if (!deal) return null;
  const open = isOpenStage(deal.stage);
  const nb = isOpenStage(deal.stage) ? neighborStages(deal.stage) : { prev: null, next: null };
  const step = open ? stepLine(deal) : null;
  const back = !open ? reopenStage(deal, events) : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.title}>{dealHead(deal)}</Text>
        <Text style={styles.meta}>
          {`${STAGE_LABEL[deal.stage]} · ${deal.amount != null ? fmtMoney(deal.amount) : 'сумма не названа'}`}
        </Text>
        {step ? <Text style={styles.meta}>{`Шаг: ${step}`}</Text> : null}
        {deal.stage === 'lost' && deal.lostReason ? <Text style={styles.meta}>{`Причина: ${deal.lostReason}`}</Text> : null}

        {open ? (
          <>
            {nb.prev || nb.next ? (
              <View style={styles.row}>
                {nb.prev ? <StageButton label={`← ${STAGE_LABEL[nb.prev]}`} disabled={busy} onPress={() => void onMove(nb.prev as DealStage)} /> : null}
                {nb.next ? <StageButton label={`${STAGE_LABEL[nb.next]} →`} disabled={busy} onPress={() => void onMove(nb.next as DealStage)} /> : null}
              </View>
            ) : null}
            <View style={styles.row}>
              <StageButton label="Выиграна" tone="success" disabled={busy} onPress={() => void onMove('won')} />
              <StageButton label="Проиграна" tone="danger" disabled={busy} onPress={onLost} />
            </View>
          </>
        ) : (
          <View style={styles.row}>
            {canRecordIncome(deal) ? <StageButton label="Записать доход" tone="primary" disabled={busy} onPress={onRecord} /> : null}
            {back ? <StageButton label="Вернуть в работу" disabled={busy} onPress={() => void onMove(back)} /> : null}
          </View>
        )}

        <ScrollView style={styles.history}>
          {events.map((e) => (
            <Text key={e.id} style={styles.event}>
              {eventLine(e)}
            </Text>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      padding: spacing.lg,
      borderTopLeftRadius: borderRadius.xl,
      borderTopRightRadius: borderRadius.xl,
      maxHeight: '75%',
      backgroundColor: c.background,
    },
    title: { color: c.text, fontSize: fontSize.lg, fontWeight: '700' },
    meta: { color: c.textSecondary, fontSize: fontSize.sm, marginTop: spacing.xs },
    row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    history: { marginTop: spacing.md },
    event: { color: c.textSecondary, fontSize: fontSize.xs, marginBottom: 4 },
  });
}
