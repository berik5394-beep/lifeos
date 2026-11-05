import React, { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { borderRadius, fontSize, spacing } from '@/constants';
import { fmtMoney, isOpenStage, type Deal } from '@/services/deals';
import { closedLine, dealHead, stepLine, stepTone } from '@/services/deals-view';

/** Строка сделки: клиент — что продаём, шаг (просрочен — красным, сегодня — жёлтым), сумма. */
export const DealRow = memo(function DealRow({
  deal,
  today,
  onPress,
}: {
  deal: Deal;
  today: string;
  onPress: (id: string) => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const open = isOpenStage(deal.stage);
  const sub = open ? stepLine(deal) : closedLine(deal);
  const tone = stepTone(deal, today);
  const subStyle = !open ? styles.sub : tone === 'overdue' ? styles.subOverdue : tone === 'today' ? styles.subToday : styles.sub;
  const press = useCallback(() => onPress(deal.id), [onPress, deal.id]);

  return (
    <Pressable onPress={press} style={styles.row} accessibilityRole="button">
      <View style={styles.main}>
        <Text style={styles.title} numberOfLines={2}>
          {dealHead(deal)}
        </Text>
        {sub ? <Text style={subStyle}>{sub}</Text> : null}
      </View>
      {open && deal.amount != null ? <Text style={styles.amount}>{fmtMoney(deal.amount)}</Text> : null}
    </Pressable>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  const sub = { fontSize: fontSize.sm, marginTop: 2 } as const;
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.md,
      borderRadius: borderRadius.md,
      marginBottom: spacing.sm,
      backgroundColor: c.surface,
    },
    main: { flex: 1, marginRight: spacing.sm },
    title: { color: c.text, fontSize: fontSize.md, fontWeight: '600' },
    sub: { ...sub, color: c.textSecondary },
    subOverdue: { ...sub, color: c.danger },
    subToday: { ...sub, color: c.warning },
    amount: { color: c.text, fontSize: fontSize.md, fontWeight: '700' },
  });
}
