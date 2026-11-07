import React, { memo, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { api, BRAIN_TIMEOUT_MS } from '@/services/api';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';

export type PortraitStatus = 'ok' | 'need_more' | 'unavailable';
export interface Portrait {
  status: PortraitStatus;
  text: string | null;
  updatedAt: string | null;
  basedOn: number;
}

/** Подпись под портретом/вместо него — по состоянию с сервера. */
export function portraitNote(p: Portrait | null, failed: boolean): string | null {
  if (failed) return 'Не получилось открыть портрет — потяни вниз, попробую ещё раз.';
  if (!p) return null;
  if (p.status === 'need_more') return 'Пока рано описывать тебя — расскажи о себе ещё немного, и я напишу, каким тебя вижу.';
  if (p.status === 'unavailable') return 'Не получилось написать честно — потяни вниз, попробую ещё раз.';
  if (!p.updatedAt) return null;
  const d = new Date(p.updatedAt);
  // «по 1 факту», «по 21 факту», но «по 2/5/11 фактам».
  const word = p.basedOn % 10 === 1 && p.basedOn % 100 !== 11 ? 'факту' : 'фактам';
  return `Обновлено ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} · по ${p.basedOn} ${word} о тебе`;
}

/**
 * «Каким я тебя вижу» — робот сам описывает человека по фактам со всего
 * приложения (память, люди, привычки, траты, цели, дневник). Сервер:
 * GET /memory/portrait (services/portrait.ts).
 */
export const PortraitCard = memo(function PortraitCard({ token, reloadKey }: { token: string | null; reloadKey: number }) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [portrait, setPortrait] = useState<Portrait | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setLoading(true);
    // Портрет пишет модель — бывает дольше обычных 15 с.
    api
      .get<Portrait>('/memory/portrait', token, { timeoutMs: BRAIN_TIMEOUT_MS })
      .then((p) => {
        if (!alive) return;
        setPortrait(p);
        setFailed(false);
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token, reloadKey]);

  const note = portraitNote(portrait, failed && !portrait);
  return (
    <View style={styles.card} accessibilityLabel="Каким я тебя вижу">
      <Text style={styles.title}>Каким я тебя вижу</Text>
      {loading && !portrait ? (
        <View style={styles.row}>
          <ActivityIndicator size="small" color={c.primary} />
          <Text style={styles.note}>Думаю, каким тебя вижу…</Text>
        </View>
      ) : null}
      {portrait?.text ? <Text style={styles.text}>{portrait.text}</Text> : null}
      {note && !(loading && !portrait) ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: { backgroundColor: c.surface, borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md, gap: spacing.xs },
    title: { fontSize: fontSize.sm, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    text: { fontSize: fontSize.md, color: c.text, lineHeight: 23 },
    note: { fontSize: fontSize.xs, color: c.textSecondary, lineHeight: 18 },
  });
}
