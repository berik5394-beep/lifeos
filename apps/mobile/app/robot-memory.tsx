import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { formatDate } from '@/utils/dates';
import { hapticLight } from '@/services/haptics';
import {
  factsAbout,
  groupFacts,
  isEmpty,
  mentionedAgo,
  type AboutMe,
  type AboutMeFact,
  type AboutMePerson,
} from '@/components/memory/about-me-logic';

type Colors = ReturnType<typeof useColors>;
/** Сколько висит «Забыл. Вернуть?» после «Неправда». */
const UNDO_MS = 6000;

/**
 * «Что я о тебе помню» (робот-друг, пункт 1). Человек видит, что робот его
 * знает — люди, факты, решения, что волновало, — и может сказать «неправда»:
 * робот забывает (обратимо, можно вернуть). Раньше память была, но её не
 * было видно — «меня запомнили» не ощущалось.
 */
export default function RobotMemoryScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<AboutMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [undo, setUndo] = useState<AboutMeFact | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = formatDate(new Date());

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setData(await api.get<AboutMe>('/memory/about-me', token));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось открыть память. Попробуй ещё раз.');
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const forget = useCallback(
    async (fact: AboutMeFact) => {
      if (!token) return;
      hapticLight();
      // Сразу убрать с экрана; не вышло — вернуть и сказать честно.
      setData((d) => (d ? { ...d, facts: d.facts.filter((f) => f.id !== fact.id) } : d));
      setUndo(fact);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
      try {
        await api.post(`/memory/${fact.id}/forget`, {}, token);
      } catch {
        setData((d) => (d ? { ...d, facts: [fact, ...d.facts] } : d));
        setUndo(null);
        setError('Не получилось забыть — нет связи. Попробуй ещё раз.');
      }
    },
    [token],
  );

  const restore = useCallback(async () => {
    if (!token || !undo) return;
    const fact = undo;
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setData((d) => (d ? { ...d, facts: [fact, ...d.facts] } : d));
    try {
      await api.post(`/memory/${fact.id}/restore`, {}, token);
    } catch {
      setData((d) => (d ? { ...d, facts: d.facts.filter((f) => f.id !== fact.id) } : d));
      setError('Не получилось вернуть — нет связи.');
    }
  }, [token, undo]);

  const sections = useMemo(() => (data ? groupFacts(data) : []), [data]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={c.primary} />}
      >
        <View style={styles.intro}>
          <Text style={styles.introText}>
            Это то, что я запомнил из наших разговоров. Если что-то не так — нажми «Неправда», и я забуду.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isEmpty(data) && !error ? (
          <Text style={styles.empty}>
            Пока я мало о тебе знаю. Расскажи о себе, о близких, о том, что для тебя важно, — я запомню.
          </Text>
        ) : null}

        {data && data.people.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Люди в твоей жизни</Text>
            {data.people.map((p) => (
              <PersonCard
                key={p.id}
                person={p}
                facts={factsAbout(p, data.facts)}
                open={openPerson === p.id}
                onToggle={() => setOpenPerson((cur) => (cur === p.id ? null : p.id))}
                onForget={forget}
                today={today}
                styles={styles}
                c={c}
              />
            ))}
          </View>
        ) : null}

        {sections.map((s) => (
          <View key={s.key} style={styles.section}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <View style={styles.card}>
              {s.facts.map((f, i) => (
                <FactRow key={f.id} fact={f} first={i === 0} onForget={forget} today={today} styles={styles} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      {undo ? (
        <View style={styles.undoBar} accessibilityLiveRegion="polite">
          <Text style={styles.undoText} numberOfLines={2}>
            Забыл: «{undo.content}»
          </Text>
          <Pressable onPress={() => void restore()} accessibilityRole="button" accessibilityLabel="Вернуть воспоминание" hitSlop={8}>
            <Text style={styles.undoAction}>Вернуть</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const PersonCard = memo(function PersonCard({
  person,
  facts,
  open,
  onToggle,
  onForget,
  today,
  styles,
  c,
}: {
  person: AboutMePerson;
  facts: AboutMeFact[];
  open: boolean;
  onToggle: () => void;
  onForget: (f: AboutMeFact) => void;
  today: string;
  styles: ReturnType<typeof createStyles>;
  c: Colors;
}) {
  const details = [...person.facts, ...person.relations];
  return (
    <View style={styles.card}>
      <Pressable onPress={onToggle} style={styles.personHead} accessibilityRole="button" accessibilityLabel={`${person.name}, подробнее`}>
        <View style={styles.flex}>
          <Text style={styles.personName}>{person.name}</Text>
          {details.length > 0 ? <Text style={styles.personFacts}>{details.join(' · ')}</Text> : null}
          <Text style={styles.meta}>упоминал(а) {mentionedAgo(person.lastMentioned, today)}</Text>
        </View>
        {facts.length > 0 ? (
          <View style={styles.personRight}>
            <Text style={styles.count}>{facts.length}</Text>
            <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textSecondary} />
          </View>
        ) : null}
      </Pressable>
      {open
        ? facts.map((f, i) => <FactRow key={f.id} fact={f} first={i === 0} onForget={onForget} today={today} styles={styles} />)
        : null}
    </View>
  );
});

const FactRow = memo(function FactRow({
  fact,
  first,
  onForget,
  today,
  styles,
}: {
  fact: AboutMeFact;
  first: boolean;
  onForget: (f: AboutMeFact) => void;
  today: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={[styles.factRow, !first && styles.factDivider]}>
      <View style={styles.flex}>
        <Text style={styles.factText}>{fact.content}</Text>
        <Text style={styles.meta}>{mentionedAgo(fact.createdAt, today)}</Text>
      </View>
      <Pressable
        onPress={() => onForget(fact)}
        style={styles.forgetBtn}
        accessibilityRole="button"
        accessibilityLabel={`Неправда: ${fact.content}`}
        hitSlop={6}
      >
        <Text style={styles.forgetText}>Неправда</Text>
      </Pressable>
    </View>
  );
});

function createStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    center: { alignItems: 'center', justifyContent: 'center' },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    flex: { flex: 1 },
    intro: { backgroundColor: c.surface, borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md },
    introText: { fontSize: fontSize.sm, color: c.textSecondary, lineHeight: 20 },
    error: { color: c.danger, fontSize: fontSize.sm, marginBottom: spacing.md },
    empty: { color: c.textSecondary, fontSize: fontSize.md, textAlign: 'center', marginTop: spacing.xl, lineHeight: 22 },
    section: { marginBottom: spacing.lg },
    sectionTitle: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: spacing.sm,
    },
    card: { backgroundColor: c.surface, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
    personHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm },
    personName: { fontSize: fontSize.md, fontWeight: '700', color: c.text },
    personFacts: { fontSize: fontSize.sm, color: c.textSecondary, marginTop: 2 },
    personRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    count: { fontSize: fontSize.sm, color: c.textSecondary, fontWeight: '600' },
    meta: { fontSize: fontSize.xs, color: c.textMuted, marginTop: 2 },
    factRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2, gap: spacing.sm },
    factDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    factText: { fontSize: fontSize.md, color: c.text, lineHeight: 21 },
    forgetBtn: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: c.border,
    },
    forgetText: { fontSize: fontSize.xs, color: c.textSecondary, fontWeight: '600' },
    undoBar: {
      position: 'absolute',
      left: spacing.md,
      right: spacing.md,
      bottom: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: c.text,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    undoText: { flex: 1, color: c.background, fontSize: fontSize.sm },
    undoAction: { color: c.background, fontSize: fontSize.sm, fontWeight: '700', textDecorationLine: 'underline' },
  });
}
