import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { diaryDayLabel, type DiaryEntry } from '@/components/memory/robot-diary-logic';

type Colors = ReturnType<typeof useColors>;

/**
 * Дневник робота (робот-друг, пункт 3). Робот от первого лица пишет пару
 * строк о каждом дне — только по реальным фактам (задачи, привычки, дневник,
 * о чём говорили). Пустой день — без записи: робот не выдумывает.
 */
export default function RobotDiaryScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const token = useAuthStore((s) => s.token);
  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const r = await api.get<{ entries: DiaryEntry[] }>('/robot/diary', token);
      setEntries(r.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось открыть дневник. Попробуй ещё раз.');
      setEntries((prev) => prev ?? []);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (entries === null) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={c.primary} />
        <Text style={styles.loadingText}>Открываю дневник…</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={entries}
      keyExtractor={(e) => e.day}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.primary} />}
      ListHeaderComponent={
        <>
          <View style={styles.intro}>
            <Text style={styles.introText}>
              Это мой дневник — пара строк о каждом нашем дне. Пишу только о том, что было на самом деле. Вечером
              появляется запись о сегодняшнем дне.
            </Text>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      }
      ListEmptyComponent={
        error ? null : (
          <Text style={styles.empty}>
            Пока пусто. Закрой задачу, отметь привычку или просто поговори со мной — вечером я напишу о нашем дне.
          </Text>
        )
      }
      renderItem={({ item }) => <EntryCard entry={item} styles={styles} />}
    />
  );
}

const EntryCard = memo(function EntryCard({ entry, styles }: { entry: DiaryEntry; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.card}>
      <Text style={styles.day}>{diaryDayLabel(entry.day, new Date())}</Text>
      <Text style={styles.text}>{entry.text}</Text>
    </View>
  );
});

function createStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
    loadingText: { color: c.textSecondary, fontSize: fontSize.sm },
    content: { padding: spacing.md, paddingBottom: spacing.xl },
    intro: { backgroundColor: c.surface, borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md },
    introText: { fontSize: fontSize.sm, color: c.textSecondary, lineHeight: 20 },
    error: { color: c.danger, fontSize: fontSize.sm, marginBottom: spacing.md },
    empty: { color: c.textSecondary, fontSize: fontSize.md, textAlign: 'center', marginTop: spacing.xl, lineHeight: 22 },
    card: { backgroundColor: c.surface, borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.sm },
    day: { fontSize: fontSize.xs, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.xs },
    text: { fontSize: fontSize.md, color: c.text, lineHeight: 22 },
  });
}
