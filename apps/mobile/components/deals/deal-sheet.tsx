import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/use-colors';
import { borderRadius, fontSize, spacing } from '@/constants';
import { OPEN_STAGES, STAGE_LABEL, fmtMoney, fmtMoneyExact, isOpenStage, neighborStages, type Deal, type DealEvent, type DealStage } from '@/services/deals';
import { LOST_REASONS, canRecordIncome, dealHead, eventLine, reopenStage, stepLine } from '@/services/deals-view';
import { dealErrorText, useDealIncome } from '@/hooks/use-deal-income';
import { useDealStore } from '@/stores/deal-store';
import { useFinanceStore } from '@/stores/finance-store';
import { StageButton } from '@/components/deals/stage-button';
import { AmountSheet } from '@/components/deals/amount-sheet';
import { StepSheet } from '@/components/deals/step-sheet';

/**
 * Карточка сделки: стадия (кнопки соседних), «Выиграна» → «Записать доход N ₸?»,
 * «Проиграна» (причина), шаг, история. Закрытую можно вернуть в работу.
 */
export const DealSheet = memo(function DealSheet({ deal, onClose }: { deal: Deal | null; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(c), [c]);
  const moveStage = useDealStore((s) => s.moveStage);
  const removeIncome = useFinanceStore((s) => s.deleteIncome);
  const fetchOne = useDealStore((s) => s.fetchOne);
  const { offer, record } = useDealIncome();
  const [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState(false);
  // Синхронный замок от двойного тапа: setBusy применится только к следующему рендеру.
  const inFlight = useRef(false);
  // Причина проигрыша — кнопками в карточке: Alert на Android показывает не больше 3 кнопок.
  const [askReason, setAskReason] = useState(false);
  // «Вернуть в работу», а из какой стадии закрыли — не знаем: спрашиваем кнопками стадий.
  const [pickStage, setPickStage] = useState(false);
  // Правка суммы / шага — формой поверх карточки (внутри её модалки: так iOS покажет вторую).
  const [editing, setEditing] = useState<'amount' | 'step' | null>(null);

  const dealId = deal?.id ?? null;
  const updatedAt = deal?.updatedAt ?? null;
  // Другая сделка (или карточку закрыли) — замок снят, кнопки живые.
  useEffect(() => {
    inFlight.current = false;
    setBusy(false);
    setEditing(null);
  }, [dealId]);

  // История: старую держим на экране, пока не придёт новая (без мигания пустотой).
  const historyKey = dealId ? `${dealId}:${updatedAt ?? ''}` : null;
  useEffect(() => {
    let alive = true;
    setAskReason(false);
    setPickStage(false);
    if (dealId && historyKey) {
      void fetchOne(dealId).then((d) => {
        if (!alive) return;
        setHistory((prev) =>
          d
            ? { dealId, key: historyKey, events: d.events, failed: false }
            : { dealId, key: historyKey, events: prev?.dealId === dealId ? prev.events : [], failed: true },
        );
      });
    }
    return () => {
      alive = false;
    };
  }, [dealId, historyKey, fetchOne]);
  const events = history && history.dealId === dealId ? history.events : NO_EVENTS;
  /** История для ЭТОЙ версии сделки загружена (или точно не загрузится). */
  const historyReady = !!history && history.key === historyKey;
  const historyFailed = historyReady && !!history?.failed;

  const lock = useCallback((): boolean => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    return true;
  }, []);
  const unlock = useCallback(() => {
    inFlight.current = false;
    setBusy(false);
  }, []);
  /** Конец действия с закрытием карточки (вопрос про доход тоже держит замок до ответа). */
  const finishAndClose = useCallback(() => {
    unlock();
    onClose();
  }, [unlock, onClose]);

  const onMove = useCallback(
    async (stage: DealStage, lostReason?: string) => {
      if (!deal || !lock()) return;
      try {
        const r = await moveStage(deal.id, stage, lostReason);
        // «Выиграна» → «Проиграна»: доход по сделке остался в финансах — спросить.
        if (r.leftIncome) {
          const left = r.leftIncome;
          Alert.alert(
            'Доход по сделке остался',
            `По этой сделке записан доход ${fmtMoneyExact(left.amount)}. Убрать его из финансов?`,
            [
              { text: 'Оставить', style: 'cancel', onPress: finishAndClose },
              {
                text: 'Убрать',
                style: 'destructive',
                onPress: () => {
                  removeIncome(left.id)
                    .catch(() => Alert.alert('Не получилось', 'Доход не убран — попробуй в «Финансах».'))
                    .finally(finishAndClose);
                },
              },
            ],
            { cancelable: true, onDismiss: finishAndClose },
          );
          return;
        }
        if (r.incomeOffer && r.deal.amount != null) {
          // Карточка открыта, пока идёт вопрос про доход: Alert поверх закрывающейся модалки на iOS теряется.
          offer(r.deal, finishAndClose);
          return;
        }
        finishAndClose();
      } catch (err) {
        unlock();
        Alert.alert('Не получилось', dealErrorText(err));
      }
    },
    [deal, lock, unlock, moveStage, offer, finishAndClose, removeIncome],
  );

  // Стабильные обработчики кнопок (value — из StageButton): inline-лямбды ломали memo.
  const onMoveTo = useCallback(
    (stage: string | undefined) => {
      if (stage && isOpenStage(stage)) void onMove(stage);
    },
    [onMove],
  );
  const onWon = useCallback(() => void onMove('won'), [onMove]);
  const onLostReason = useCallback((reason: string | undefined) => void onMove('lost', reason), [onMove]);
  const onLost = useCallback(() => setAskReason(true), []);
  const cancelLost = useCallback(() => setAskReason(false), []);
  const cancelPick = useCallback(() => setPickStage(false), []);
  const editAmount = useCallback(() => setEditing('amount'), []);
  const editStep = useCallback(() => setEditing('step'), []);
  const closeEditor = useCallback(() => setEditing(null), []);
  // Сумма у выигранной сделки появилась/поменялась — сервер предлагает записать доход:
  // спрашиваем поверх ещё открытой формы, закрываем её после ответа.
  const onAmountSaved = useCallback(
    (r: { deal: Deal; incomeOffer: boolean }) => {
      if (r.incomeOffer && r.deal.amount != null) offer(r.deal, closeEditor);
      else closeEditor();
    },
    [offer, closeEditor],
  );
  const back = deal && !isOpenStage(deal.stage) && historyReady && !historyFailed ? reopenStage(deal, events) : null;
  const onReopen = useCallback(() => {
    if (back) void onMove(back);
    else setPickStage(true);
  }, [back, onMove]);

  const onRecord = useCallback(() => {
    if (deal && lock()) record(deal, finishAndClose);
  }, [deal, lock, record, finishAndClose]);
  // Пока идёт запрос — карточку не закрываем: ответ/ошибка придут к открытой карточке.
  const requestClose = useCallback(() => {
    if (!inFlight.current) onClose();
  }, [onClose]);

  if (!deal) return null;
  const open = isOpenStage(deal.stage);
  const nb = isOpenStage(deal.stage) ? neighborStages(deal.stage) : { prev: null, next: null };
  const step = open ? stepLine(deal) : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={requestClose}>
      <Pressable style={styles.backdrop} onPress={requestClose} disabled={busy} accessibilityLabel="Закрыть" />
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
                {nb.prev ? <StageButton label={`← ${STAGE_LABEL[nb.prev]}`} disabled={busy} value={nb.prev} onPress={onMoveTo} /> : null}
                {nb.next ? <StageButton label={`${STAGE_LABEL[nb.next]} →`} disabled={busy} value={nb.next} onPress={onMoveTo} /> : null}
              </View>
            ) : null}
            {askReason ? (
              <>
                <Text style={styles.ask}>Почему проиграна?</Text>
                <View style={styles.row}>
                  {LOST_REASONS.slice(0, 2).map((r) => (
                    <StageButton key={r} label={capitalize(r)} disabled={busy} value={r} onPress={onLostReason} />
                  ))}
                </View>
                <View style={styles.row}>
                  {LOST_REASONS.slice(2).map((r) => (
                    <StageButton key={r} label={capitalize(r)} disabled={busy} value={r} onPress={onLostReason} />
                  ))}
                  <StageButton label="Без причины" disabled={busy} onPress={onLostReason} />
                </View>
                <View style={styles.row}>
                  <StageButton label="Отмена" disabled={busy} onPress={cancelLost} />
                </View>
              </>
            ) : (
              <View style={styles.row}>
                <StageButton label="Выиграна" tone="success" disabled={busy} onPress={onWon} />
                <StageButton label="Проиграна" tone="danger" disabled={busy} onPress={onLost} />
              </View>
            )}
          </>
        ) : pickStage ? (
          <>
            <Text style={styles.ask}>В какую стадию вернуть?</Text>
            {[OPEN_STAGES.slice(0, 2), OPEN_STAGES.slice(2)].map((pair) => (
              <View key={pair[0]} style={styles.row}>
                {pair.map((st) => (
                  <StageButton key={st} label={STAGE_LABEL[st]} disabled={busy} value={st} onPress={onMoveTo} />
                ))}
              </View>
            ))}
            <View style={styles.row}>
              <StageButton label="Отмена" disabled={busy} onPress={cancelPick} />
            </View>
          </>
        ) : (
          <View style={styles.row}>
            {canRecordIncome(deal) ? <StageButton label="Записать доход" tone="primary" disabled={busy} onPress={onRecord} /> : null}
            {/* Пока история не пришла, не знаем, куда возвращать, — кнопка ждёт. */}
            <StageButton label="Вернуть в работу" disabled={busy || !historyReady} onPress={onReopen} />
          </View>
        )}

        {deal.stage !== 'lost' ? (
          <View style={styles.row}>
            <StageButton label="Изменить сумму" disabled={busy} onPress={editAmount} />
            {open ? <StageButton label="Изменить шаг" disabled={busy} onPress={editStep} /> : null}
          </View>
        ) : null}

        <ScrollView style={styles.history}>
          {events.map((e) => (
            <Text key={e.id} style={styles.event}>
              {eventLine(e)}
            </Text>
          ))}
        </ScrollView>
      </View>
      <AmountSheet deal={editing === 'amount' ? deal : null} onClose={closeEditor} onSaved={onAmountSaved} />
      <StepSheet deal={editing === 'step' ? deal : null} onClose={closeEditor} />
    </Modal>
  );
});

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

interface History {
  dealId: string;
  /** dealId:updatedAt — к какой версии сделки относится история. */
  key: string;
  events: DealEvent[];
  /** Не загрузилась: стадию для «Вернуть в работу» спросим. */
  failed: boolean;
}
const NO_EVENTS: DealEvent[] = [];

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
    ask: { color: c.text, fontSize: fontSize.sm, fontWeight: '600', marginTop: spacing.md },
    // Длинная история сжимается внутри шторки (maxHeight 75%), а не выталкивает кнопки.
    history: { marginTop: spacing.md, flexShrink: 1 },
    event: { color: c.textSecondary, fontSize: fontSize.xs, marginBottom: 4 },
  });
}
