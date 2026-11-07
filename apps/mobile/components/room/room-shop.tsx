import React, { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import {
  ROOM_TIERS,
  TIER_COLOR,
  TIER_LABEL,
  roomItemEmoji,
  shopState,
  type OwnedItem,
  type RoomVariant,
  type RoomVariantTier,
} from '@/services/room-catalog';
import { levelTitle, nextLine, type Friendship } from '@/services/friendship';

type Tab = RoomVariantTier | 'storage';
const TABS: Tab[] = [...ROOM_TIERS, 'free', 'friend', 'storage'];
const TAB_LABEL: Record<Tab, string> = { ...TIER_LABEL, storage: 'Кладовка' };

/**
 * Робот-эпик, Часть 6: «Обставить» — магазин ремонта за монеты. Вкладки по
 * классам (по 10 вариантов), бесплатный декор и кладовка (убранное — вернуть
 * бесплатно). Цены — с сервера. «Дружба» — подарки, которые открывает
 * уровень дружбы (робот-друг №4).
 */
export const RoomShop = memo(function RoomShop({
  catalog,
  owned,
  coins,
  friendship = null,
  busy,
  onBuy,
  onPlace,
}: {
  catalog: RoomVariant[];
  owned: OwnedItem[];
  coins: number | null;
  friendship?: Friendship | null;
  /** Ключ варианта, покупка которого идёт. */
  busy: string | null;
  onBuy: (v: RoomVariant) => void;
  onPlace: (id: string) => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [tab, setTab] = useState<Tab>('budget');
  const labelOf = useMemo(() => new Map(catalog.map((v) => [v.key, v.label])), [catalog]);
  const stored = owned.filter((o) => o.slot === null);

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabOn, t !== 'free' && t !== 'friend' && t !== 'storage' && { borderColor: TIER_COLOR[t].frame }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
              {TAB_LABEL[t]}
              {t === 'storage' && stored.length > 0 ? ` · ${stored.length}` : ''}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {tab === 'storage' ? (
        stored.length === 0 ? (
          <Text style={styles.empty}>Кладовка пуста. Убери предмет долгим нажатием — он появится здесь.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
            {stored.map((o) => (
              <View key={o.id} style={styles.card}>
                <Text style={styles.emoji}>{roomItemEmoji(o.itemKey)}</Text>
                <Text style={styles.label} numberOfLines={2}>
                  {(o.variantKey && labelOf.get(o.variantKey)) || o.itemKey}
                </Text>
                <Pressable style={[styles.btn, styles.btnBuy]} onPress={() => onPlace(o.id)} accessibilityRole="button">
                  <Text style={styles.btnText}>Поставить</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )
      ) : catalog.length === 0 ? (
        <Text style={styles.empty}>Магазин загрузится, когда будет связь.</Text>
      ) : tab === 'friend' && !catalog.some((v) => v.tier === 'friend') ? (
        <Text style={styles.empty}>Подарки дружбы появятся после перезапуска приложения.</Text>
      ) : tab === 'friend' && friendship === null ? (
        <Text style={styles.empty}>Узнаю наш уровень дружбы…</Text>
      ) : (
        <>
        {tab === 'friend' && friendship && (
          <View style={styles.friendHead} accessibilityLabel={`Уровень дружбы: ${friendship.title}`}>
            <Text style={styles.friendTitle}>
              💛 Мы — «{friendship.title}» · {nextLine(friendship)}
            </Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round(friendship.progress * 100)}%` }]} />
            </View>
            <Text style={styles.friendHint}>Растёт, когда мы разговариваем и закрываются дела. Не падает.</Text>
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
          {catalog
            .filter((v) => v.tier === tab)
            .map((v) => {
              const st = shopState(v, owned, coins, friendship?.level ?? null);
              const color = v.tier !== 'free' && v.tier !== 'friend' ? TIER_COLOR[v.tier].frame : c.border;
              return (
                <View key={v.key} style={[styles.card, { borderColor: color }]}>
                  <Text style={[styles.emoji, st.kind === 'locked' && styles.lockedEmoji]}>{st.kind === 'locked' ? '🔒' : v.emoji}</Text>
                  <Text style={styles.label} numberOfLines={2}>
                    {v.label}
                  </Text>
                  <Text style={styles.price}>{v.tier === 'friend' ? 'подарок' : v.price > 0 ? `🪙 ${v.price}` : 'бесплатно'}</Text>
                  <Pressable
                    style={[styles.btn, st.kind === 'buy' ? styles.btnBuy : styles.btnOff]}
                    disabled={st.kind !== 'buy' || busy !== null}
                    onPress={() => onBuy(v)}
                    accessibilityRole="button"
                    accessibilityLabel={`${v.label}: ${st.kind === 'buy' ? 'взять' : st.kind === 'owned' ? 'уже есть' : st.kind === 'locked' ? `откроется на уровне «${levelTitle(friendship, st.minLevel)}»` : 'не хватает монет'}`}
                  >
                    <Text style={styles.btnText}>
                      {busy === v.key
                        ? '…'
                        : st.kind === 'buy'
                          ? v.price > 0
                            ? 'Купить'
                            : 'Взять'
                          : st.kind === 'owned'
                            ? 'Есть'
                            : st.kind === 'locked'
                              ? `С «${levelTitle(friendship, st.minLevel)}»`
                              : `Не хватает ${st.need} 🪙`}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
        </ScrollView>
        </>
      )}
    </View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    wrap: { gap: spacing.xs },
    tabs: { gap: 6, paddingHorizontal: spacing.md },
    tab: {
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 5,
      borderRadius: borderRadius.lg,
      backgroundColor: c.surface,
      borderWidth: 1.5,
      borderColor: c.surface,
    },
    tabOn: { backgroundColor: c.surfaceLight },
    tabText: { fontSize: fontSize.xs, color: c.textSecondary, fontWeight: '600' },
    tabTextOn: { color: c.text },
    cards: { gap: spacing.sm, paddingHorizontal: spacing.md },
    card: {
      width: 112,
      padding: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: c.surface,
      borderWidth: 1.5,
      borderColor: c.border,
      alignItems: 'center',
      gap: 2,
    },
    emoji: { fontSize: 26 },
    label: { fontSize: fontSize.xs, color: c.text, textAlign: 'center', minHeight: 30 },
    price: { fontSize: fontSize.xs, color: c.warning, fontWeight: '700' },
    btn: { marginTop: 4, paddingVertical: 5, paddingHorizontal: 6, borderRadius: borderRadius.sm, alignSelf: 'stretch' },
    btnBuy: { backgroundColor: c.primary },
    btnOff: { backgroundColor: c.surfaceLight },
    btnText: { fontSize: 11, color: c.text, textAlign: 'center', fontWeight: '600' },
    lockedEmoji: { opacity: 0.7 },
    friendHead: { paddingHorizontal: spacing.md, gap: 4 },
    friendTitle: { fontSize: fontSize.sm, color: c.text, fontWeight: '600' },
    friendHint: { fontSize: fontSize.xs, color: c.textSecondary },
    bar: { height: 6, borderRadius: 3, backgroundColor: c.surfaceLight, overflow: 'hidden' },
    barFill: { height: 6, borderRadius: 3, backgroundColor: c.primary },
    empty: { fontSize: fontSize.sm, color: c.textSecondary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  });
}
