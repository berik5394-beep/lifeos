import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Animated, Easing, ActivityIndicator, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { CharacterRenderer } from '@/components/characters/CharacterRenderer';
import { CHARACTERS, getCharacter } from '@/constants/characters';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { useAuthStore } from '@/stores/auth-store';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://172.20.10.4:3000';

const RANK_ICONS: Record<string, string> = {
  bronze: '🥉', silver: '🥈', gold: '🥇',
  platinum: '💎', diamond: '💠', master: '👑', legend: '🏆',
};

const RANK_COLORS: Record<string, string> = {
  bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700',
  platinum: '#00CED1', diamond: '#B9F2FF', master: '#9C27B0', legend: '#FF6B35',
};

interface ArenaProfile {
  trophies: number; wins: number; losses: number; draws: number;
  winStreak: number; bestWinStreak: number; rank: string; powerScore: number;
}
interface Power {
  total: number;
  breakdown: { level: number; streak: number; health: number; equipment: number };
}
interface Opponent {
  id: string; userId: string; name: string; trophies: number; rank: string;
  wins: number; losses: number; powerScore: number;
  character: { name: string; characterType: string; level: number; streak: number } | null;
}
interface BattleResult {
  battle: {
    id: string; result: 'attacker' | 'defender' | 'draw';
    attackerRoll: number; defenderRoll: number;
    trophyChange: number; xpReward: number; log: string;
  };
  attacker: any; defender: any;
}
interface HistoryEntry {
  id: string; isAttacker: boolean; won: boolean; draw: boolean;
  opponent: { name: string; char: string; level: number };
  myPower: number; oppPower: number; trophyChange: number;
  xpReward: number; log: string; createdAt: string;
}

export default function ArenaScreen() {
  const navigation = useNavigation();
  const { token } = useAuthStore();
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  const [profile, setProfile] = useState<ArenaProfile | null>(null);
  const [power, setPower] = useState<Power | null>(null);
  const [myChar, setMyChar] = useState<any>(null);
  const [opponents, setOpponents] = useState<Opponent[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [battling] = useState(false);
  const [battleResult, setBattleResult] = useState<BattleResult | null>(null);
  const [tab, setTab] = useState<'fight' | 'history' | 'leaderboard'>('fight');
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [myPosition, setMyPosition] = useState<number | null>(null);
  const [manaAmount, setManaAmount] = useState(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch(`${API}/arena/profile`, { headers });
      const data = await res.json();
      setProfile(data.profile);
      setPower(data.power);
      setMyChar(data.character);
      // Also fetch mana
      const manaRes = await fetch(`${API}/challenge/mana`, { headers });
      const manaData = await manaRes.json();
      setManaAmount(manaData.mana || 0);
    } catch (e) { console.error(e); }
  }, [token]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API}/arena/history`, { headers });
      const data = await res.json();
      setHistory(data.battles || []);
    } catch (e) { console.error(e); }
  }, [token]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(`${API}/arena/leaderboard`, { headers });
      const data = await res.json();
      setLeaderboard(data.leaderboard || []);
      setMyPosition(data.myPosition);
    } catch (e) { console.error(e); }
  }, [token]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchProfile();
      setLoading(false);
    })();
  }, []);

  // Refresh when coming back from battle screen
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchProfile();
    });
    return unsubscribe;
  }, [navigation, fetchProfile]);

  useEffect(() => {
    if (tab === 'history') fetchHistory();
    if (tab === 'leaderboard') fetchLeaderboard();
  }, [tab]);

  // Pulse animation for battle button
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const findOpponents = useCallback(async () => {
    setSearching(true);
    setBattleResult(null);
    try {
      const res = await fetch(`${API}/arena/find-opponent`, { method: 'POST', headers });
      const data = await res.json();
      setOpponents(data.opponents || []);
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось найти противников');
    } finally {
      setSearching(false);
    }
  }, [token]);

  const startBattle = useCallback((opponent: Opponent) => {
    (navigation as any).navigate('BattleScreen', {
      opponentUserId: opponent.userId,
      opponentName: opponent.name,
      opponentChar: opponent.character?.characterType || 'warrior',
      opponentLevel: opponent.character?.level || 1,
      opponentPower: opponent.powerScore,
      myChar: myChar?.characterType || 'warrior',
      myLevel: myChar?.level || 1,
      myPower: power?.total || 0,
      myName: myChar?.name || 'Герой',
    });
  }, [myChar, power, navigation]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={styles.loadingText}>Загрузка арены...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const charConfig = myChar ? getCharacter(myChar.characterType) : CHARACTERS[0];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.backText}>{'\u2190'} Назад</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Арена</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* My Profile Card */}
        {profile && charConfig && (
          <View style={[styles.profileCard, { borderColor: RANK_COLORS[profile.rank] + '60' }]}>
            <View style={styles.profileTop}>
              <CharacterRenderer character={charConfig} size={100} level={myChar?.level || 1} />
              <View style={styles.profileStats}>
                <Text style={styles.profileName}>{myChar?.name || 'Герой'}</Text>
                <View style={[styles.rankBadge, { backgroundColor: RANK_COLORS[profile.rank] }]}>
                  <Text style={styles.rankText}>
                    {RANK_ICONS[profile.rank]} {profile.rank.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.trophyText}>🏆 {profile.trophies} трофеев</Text>
                <Text style={styles.recordText}>
                  {profile.wins}W / {profile.losses}L / {profile.draws}D
                </Text>
                {profile.winStreak > 0 && (
                  <Text style={styles.streakText}>🔥 {profile.winStreak} побед подряд</Text>
                )}
                <Text style={styles.manaText}>🔮 Мана: {manaAmount}/100</Text>
              </View>
            </View>

            {/* Power breakdown */}
            {power && (
              <View style={styles.powerRow}>
                <Text style={styles.powerTotal}>⚡ {Math.round(power.total)} Power</Text>
                <View style={styles.powerBreakdown}>
                  <Text style={styles.powerItem}>LVL: {power.breakdown.level}</Text>
                  <Text style={styles.powerItem}>STR: {power.breakdown.streak}</Text>
                  <Text style={styles.powerItem}>HP: {power.breakdown.health}</Text>
                  <Text style={styles.powerItem}>EQ: {power.breakdown.equipment}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Tabs */}
        <View style={styles.tabsRow}>
          {(['fight', 'history', 'leaderboard'] as const).map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'fight' ? '⚔️ Бой' : t === 'history' ? '📜 История' : '🏆 Рейтинг'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* === FIGHT TAB === */}
        {tab === 'fight' && (
          <View>
            {/* Info banner */}
            <View style={styles.infoBanner}>
              <Text style={styles.infoBannerTitle}>⚔️ Как работает поиск</Text>
              <Text style={styles.infoBannerText}>
                Мы подбираем игроков с похожим рейтингом (±200 🏆) и уровнем силы.
                Нажми "Найти противника" — покажем 3–5 доступных героев.
              </Text>
            </View>

            {/* Search button */}
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                style={styles.searchButton}
                onPress={findOpponents}
                disabled={searching}
                activeOpacity={0.8}
              >
                {searching ? (
                  <View style={styles.searchingRow}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.searchButtonText}>Ищем противников…</Text>
                  </View>
                ) : (
                  <Text style={styles.searchButtonText}>🔍 Найти противника</Text>
                )}
              </TouchableOpacity>
            </Animated.View>

            {/* Searching state */}
            {searching && (
              <View style={styles.searchingCard}>
                <Text style={styles.searchingHint}>
                  🎯 Проверяем, кто сейчас на арене…
                </Text>
                <Text style={styles.searchingSubhint}>
                  Сравниваем рейтинг, силу и последнюю активность
                </Text>
              </View>
            )}

            {/* Battle Result */}
            {battleResult && (
              <View style={[styles.resultCard, {
                borderColor: battleResult.battle.result === 'attacker' ? '#4CAF50'
                  : battleResult.battle.result === 'draw' ? '#FF9800' : '#F44336',
              }]}>
                <Text style={styles.resultTitle}>
                  {battleResult.battle.result === 'attacker' ? '🎉 ПОБЕДА!' 
                    : battleResult.battle.result === 'draw' ? '🤝 НИЧЬЯ' : '💀 ПОРАЖЕНИЕ'}
                </Text>
                <Text style={styles.resultLog}>{battleResult.battle.log}</Text>
                <View style={styles.resultStats}>
                  <Text style={[styles.resultTrophy, {
                    color: battleResult.battle.trophyChange >= 0 ? '#4CAF50' : '#F44336'
                  }]}>
                    {battleResult.battle.trophyChange >= 0 ? '+' : ''}{battleResult.battle.trophyChange} 🏆
                  </Text>
                  <Text style={styles.resultXP}>+{battleResult.battle.xpReward} XP</Text>
                </View>
              </View>
            )}

            {/* Opponents list */}
            {opponents.length > 0 && (
              <View>
                <Text style={styles.sectionTitle}>Противники</Text>
                {opponents.map(op => {
                  const opChar = op.character ? getCharacter(op.character.characterType) : CHARACTERS[0];
                  return (
                    <View key={op.id} style={styles.opponentCard}>
                      <View style={styles.opponentInfo}>
                        {opChar && <CharacterRenderer character={opChar} size={60} level={op.character?.level || 1} showGlow={false} />}
                        <View style={styles.opponentText}>
                          <Text style={styles.opName}>{op.name}</Text>
                          <Text style={styles.opPower}>⚡ {Math.round(op.powerScore)}</Text>
                          <Text style={styles.opRecord}>
                            {RANK_ICONS[op.rank]} {op.wins}W/{op.losses}L
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={styles.attackButton}
                        onPress={() => startBattle(op)}
                        disabled={battling}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.attackButtonText}>
                          {battling ? '...' : '⚔️'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            {opponents.length === 0 && !searching && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyEmoji}>⚔️</Text>
                <Text style={styles.emptyText}>Нажми "Найти противника", чтобы начать бой!</Text>
                <Text style={styles.emptySubtext}>Побеждает тот, кто дисциплинирован</Text>
                <Text style={styles.emptyHint}>
                  💡 Совет: чем выше твой power score (уровень, streak, экипировка), тем сильнее противники.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* === HISTORY TAB === */}
        {tab === 'history' && (
          <View>
            {history.length === 0 ? (
              <Text style={styles.emptyText}>Ещё нет боёв. Начни первый!</Text>
            ) : (
              history.map(h => (
                <View key={h.id} style={[styles.historyCard, {
                  borderLeftColor: h.won ? '#4CAF50' : h.draw ? '#FF9800' : '#F44336',
                }]}>
                  <View style={styles.historyTop}>
                    <Text style={styles.historyResult}>
                      {h.won ? '✅ Победа' : h.draw ? '🤝 Ничья' : '❌ Поражение'}
                    </Text>
                    <Text style={[styles.historyTrophy, {
                      color: h.trophyChange >= 0 ? '#4CAF50' : '#F44336'
                    }]}>
                      {h.trophyChange >= 0 ? '+' : ''}{h.trophyChange} 🏆
                    </Text>
                  </View>
                  <Text style={styles.historyOpp}>
                    VS {h.opponent.name} (Lv.{h.opponent.level})
                  </Text>
                  <Text style={styles.historyPower}>
                    ⚡{Math.round(h.myPower)} vs ⚡{Math.round(h.oppPower)}
                  </Text>
                  <Text style={styles.historyDate}>
                    {new Date(h.createdAt).toLocaleDateString('ru-RU')}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}

        {/* === LEADERBOARD TAB === */}
        {tab === 'leaderboard' && (
          <View>
            {myPosition && (
              <Text style={styles.myPositionText}>Твоё место: #{myPosition}</Text>
            )}
            {leaderboard.map(entry => (
              <View key={entry.userId} style={[styles.lbRow, entry.isMe && styles.lbRowMe]}>
                <Text style={styles.lbRank}>#{entry.rank}</Text>
                <View style={styles.lbInfo}>
                  <Text style={[styles.lbName, entry.isMe && styles.lbNameMe]}>
                    {entry.name} {entry.isMe ? '(ты)' : ''}
                  </Text>
                  <Text style={styles.lbDetails}>
                    {RANK_ICONS[entry.arenaRank]} Lv.{entry.character?.level || 1} • {entry.wins}W
                  </Text>
                </View>
                <View style={styles.lbRight}>
                  <Text style={styles.lbTrophies}>🏆 {entry.trophies}</Text>
                  <Text style={styles.lbPower}>⚡ {Math.round(entry.powerScore)}</Text>
                </View>
              </View>
            ))}
            {leaderboard.length === 0 && (
              <Text style={styles.emptyText}>Пока нет игроков в рейтинге</Text>
            )}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { color: c.textSecondary, fontSize: fontSize.md, marginTop: 12 },
    scrollContent: { padding: spacing.md, paddingBottom: spacing.xl * 3 },
    header: {
      flexDirection: 'row', justifyContent: 'space-between',
      alignItems: 'center', marginBottom: spacing.lg,
    },
    backText: { color: c.primary, fontSize: fontSize.md, fontWeight: '600' },
    title: { color: c.text, fontSize: fontSize.lg + 2, fontWeight: '900' },

    // Profile Card
    profileCard: {
      backgroundColor: c.surface, borderRadius: borderRadius.xl,
      padding: spacing.lg, borderWidth: 1, marginBottom: spacing.lg,
    },
    profileTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    profileStats: { flex: 1 },
    profileName: { color: c.text, fontSize: fontSize.lg, fontWeight: '700', marginBottom: 4 },
    rankBadge: {
      alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3,
      borderRadius: 12, marginBottom: 4,
    },
    rankText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '800' },
    trophyText: { color: c.text, fontSize: fontSize.md, fontWeight: '600', marginBottom: 2 },
    recordText: { color: c.textSecondary, fontSize: fontSize.sm },
    streakText: { color: '#FF9800', fontSize: fontSize.sm, fontWeight: '600', marginTop: 2 },
    manaText: { color: '#9C27B0', fontSize: fontSize.sm, fontWeight: '600', marginTop: 2 },

    // Power
    powerRow: {
      marginTop: spacing.md, backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.md, padding: spacing.sm,
    },
    powerTotal: { color: '#FFD700', fontSize: fontSize.md, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
    powerBreakdown: { flexDirection: 'row', justifyContent: 'space-around' },
    powerItem: { color: c.textSecondary, fontSize: fontSize.xs, fontWeight: '600' },

    // Tabs
    tabsRow: { flexDirection: 'row', marginBottom: spacing.md, gap: 6 },
    tab: {
      flex: 1, paddingVertical: spacing.sm, alignItems: 'center',
      borderRadius: borderRadius.md, backgroundColor: c.surface,
    },
    tabActive: { backgroundColor: c.primary },
    tabText: { color: c.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
    tabTextActive: { color: '#fff' },

    // Search
    searchButton: {
      backgroundColor: '#E040FB', paddingVertical: spacing.md,
      borderRadius: borderRadius.lg, alignItems: 'center', marginBottom: spacing.md,
    },
    searchButtonText: { color: '#fff', fontSize: fontSize.md, fontWeight: '800' },

    // Result card
    resultCard: {
      backgroundColor: c.surface, borderRadius: borderRadius.lg,
      padding: spacing.lg, borderWidth: 2, marginBottom: spacing.md, alignItems: 'center',
    },
    resultTitle: { color: c.text, fontSize: fontSize.xl, fontWeight: '900', marginBottom: 8 },
    resultLog: { color: c.textSecondary, fontSize: fontSize.sm, textAlign: 'center', marginBottom: 8 },
    resultStats: { flexDirection: 'row', gap: spacing.lg },
    resultTrophy: { fontSize: fontSize.md, fontWeight: '700' },
    resultXP: { color: '#7ECFC0', fontSize: fontSize.md, fontWeight: '700' },

    // Opponents
    sectionTitle: { color: c.text, fontSize: fontSize.md, fontWeight: '700', marginBottom: spacing.sm },
    opponentCard: {
      backgroundColor: c.surface, borderRadius: borderRadius.md,
      padding: spacing.sm, marginBottom: spacing.xs,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    opponentInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.sm },
    opponentText: { flex: 1 },
    opName: { color: c.text, fontSize: fontSize.md, fontWeight: '700' },
    opPower: { color: '#FFD700', fontSize: fontSize.sm, fontWeight: '600' },
    opRecord: { color: c.textSecondary, fontSize: fontSize.xs },
    attackButton: {
      backgroundColor: '#F44336', width: 48, height: 48, borderRadius: 24,
      alignItems: 'center', justifyContent: 'center',
    },
    attackButtonText: { fontSize: 22 },

    // Empty state
    emptyState: { alignItems: 'center', paddingVertical: spacing.xl * 2 },
    emptyEmoji: { fontSize: 60, marginBottom: spacing.md },
    emptyText: { color: c.textSecondary, fontSize: fontSize.md, textAlign: 'center' },
    emptySubtext: { color: c.textSecondary, fontSize: fontSize.sm, marginTop: 4, fontStyle: 'italic' },
    emptyHint: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      marginTop: spacing.md,
      textAlign: 'center',
      paddingHorizontal: spacing.lg,
      lineHeight: 18,
    },
    infoBanner: {
      backgroundColor: c.surfaceAlt,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: c.border,
    },
    infoBannerTitle: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '700',
      marginBottom: 4,
    },
    infoBannerText: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      lineHeight: 18,
    },
    searchingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    searchingCard: {
      backgroundColor: c.surfaceAlt,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginTop: spacing.md,
      alignItems: 'center',
    },
    searchingHint: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    searchingSubhint: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      marginTop: 4,
    },

    // History
    historyCard: {
      backgroundColor: c.surface, borderRadius: borderRadius.md,
      padding: spacing.sm, marginBottom: spacing.xs, borderLeftWidth: 3,
    },
    historyTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
    historyResult: { color: c.text, fontSize: fontSize.sm, fontWeight: '700' },
    historyTrophy: { fontSize: fontSize.sm, fontWeight: '700' },
    historyOpp: { color: c.textSecondary, fontSize: fontSize.sm },
    historyPower: { color: c.textSecondary, fontSize: fontSize.xs },
    historyDate: { color: c.textSecondary, fontSize: fontSize.xs - 1, marginTop: 2 },

    // Leaderboard
    myPositionText: {
      color: '#FFD700', fontSize: fontSize.md, fontWeight: '800',
      textAlign: 'center', marginBottom: spacing.md,
    },
    lbRow: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface,
      borderRadius: borderRadius.md, padding: spacing.sm, marginBottom: spacing.xs,
    },
    lbRowMe: { borderWidth: 1, borderColor: c.primary },
    lbRank: { color: c.textSecondary, fontSize: fontSize.md, fontWeight: '800', width: 40 },
    lbInfo: { flex: 1 },
    lbName: { color: c.text, fontSize: fontSize.sm, fontWeight: '700' },
    lbNameMe: { color: c.primary },
    lbDetails: { color: c.textSecondary, fontSize: fontSize.xs },
    lbRight: { alignItems: 'flex-end' },
    lbTrophies: { color: '#FFD700', fontSize: fontSize.sm, fontWeight: '700' },
    lbPower: { color: c.textSecondary, fontSize: fontSize.xs },
  });
}
