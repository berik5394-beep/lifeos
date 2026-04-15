import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Animated, Easing,
  TouchableOpacity, Dimensions, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { CharacterRenderer } from '@/components/characters/CharacterRenderer';
import { getCharacter, CHARACTERS } from '@/constants/characters';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { useAuthStore } from '@/stores/auth-store';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

// Battle phases
type Phase = 'enter' | 'face-off' | 'clash' | 'result' | 'challenge';

interface RouteParams {
  opponentUserId: string;
  opponentName: string;
  opponentChar: string;
  opponentLevel: number;
  opponentPower: number;
  myChar: string;
  myLevel: number;
  myPower: number;
  myName: string;
}

// Arena ground colors per environment
const ARENA_THEMES = [
  { sky: '#0a0e27', ground: '#1a1a2e', accent: '#e94560', name: 'Тёмная Арена' },
  { sky: '#1a0a2e', ground: '#16213e', accent: '#9b59b6', name: 'Магический Колизей' },
  { sky: '#0d1b2a', ground: '#1b263b', accent: '#e07c24', name: 'Огненная Арена' },
  { sky: '#0b132b', ground: '#1c2541', accent: '#3a86ff', name: 'Ледяная Арена' },
];

export default function BattleScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const params = route.params as RouteParams;
  const { token } = useAuthStore();
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const arena = ARENA_THEMES[Math.floor(Math.random() * ARENA_THEMES.length)];

  // State
  const [phase, setPhase] = useState<Phase>('enter');
  const [battleResult, setBattleResult] = useState<any>(null);
  const [mana, setMana] = useState(0);
  const [challengeData] = useState<any>(null);

  // Animations
  const leftWalkX = useRef(new Animated.Value(-150)).current;    // attacker enters from left
  const rightWalkX = useRef(new Animated.Value(150)).current;    // defender enters from right
  const leftBounce = useRef(new Animated.Value(0)).current;
  const rightBounce = useRef(new Animated.Value(0)).current;
  const clashScale = useRef(new Animated.Value(0)).current;
  const clashOpacity = useRef(new Animated.Value(0)).current;
  const resultSlide = useRef(new Animated.Value(50)).current;
  const resultOpacity = useRef(new Animated.Value(0)).current;
  const groundPulse = useRef(new Animated.Value(1)).current;
  const starSparkle = useRef(new Animated.Value(0)).current;

  // Character shake during clash
  const leftShake = useRef(new Animated.Value(0)).current;
  const rightShake = useRef(new Animated.Value(0)).current;

  const myCharConfig = getCharacter(params.myChar) || CHARACTERS[0];
  const opCharConfig = getCharacter(params.opponentChar) || CHARACTERS[0];

  // Fetch mana on mount
  useEffect(() => {
    fetch(`${API}/challenge/mana`, { headers })
      .then(r => r.json())
      .then(d => setMana(d.mana || 0))
      .catch(() => {});
  }, []);

  // === ANIMATION SEQUENCE ===
  useEffect(() => {
    // Phase 1: Characters walk in from sides
    const walkDuration = 1200;

    // Walking bounce animation (bob up and down while walking)
    const walkBounce = (anim: Animated.Value) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: -8, duration: 150, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 150, useNativeDriver: true }),
        ]),
        { iterations: 4 }
      );

    // Ground pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(groundPulse, { toValue: 1.02, duration: 2000, useNativeDriver: true }),
        Animated.timing(groundPulse, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ])
    ).start();

    // Walk in simultaneously
    Animated.parallel([
      Animated.timing(leftWalkX, { toValue: 0, duration: walkDuration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(rightWalkX, { toValue: 0, duration: walkDuration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      walkBounce(leftBounce),
      walkBounce(rightBounce),
    ]).start(() => {
      setPhase('face-off');

      // Phase 2: Face-off pause — characters stare at each other
      setTimeout(() => {
        setPhase('clash');
        startBattle();
      }, 1500);
    });
  }, []);

  // === CLASH ANIMATION ===
  const playClashAnimation = useCallback((isWin: boolean) => {
    // Shake both characters
    const shakeAnim = (anim: Animated.Value) =>
      Animated.sequence([
        Animated.timing(anim, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(anim, { toValue: -10, duration: 50, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 8, duration: 50, useNativeDriver: true }),
        Animated.timing(anim, { toValue: -8, duration: 50, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 5, duration: 50, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]);

    // Clash explosion
    Animated.parallel([
      shakeAnim(leftShake),
      shakeAnim(rightShake),
      Animated.sequence([
        Animated.timing(clashScale, { toValue: 1.5, duration: 200, useNativeDriver: true }),
        Animated.timing(clashScale, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(clashOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
        Animated.timing(clashOpacity, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
      // Sparkles
      Animated.loop(
        Animated.sequence([
          Animated.timing(starSparkle, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(starSparkle, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]),
        { iterations: 3 }
      ),
    ]).start(() => {
      // Show result after clash
      setTimeout(() => {
        setPhase('result');
        Animated.parallel([
          Animated.timing(resultSlide, { toValue: 0, duration: 400, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true }),
          Animated.timing(resultOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        ]).start();
      }, 500);
    });
  }, []);

  // === BATTLE API CALL ===
  const startBattle = useCallback(async () => {
    try {
      const res = await fetch(`${API}/arena/battle`, {
        method: 'POST', headers,
        body: JSON.stringify({ opponentId: params.opponentUserId }),
      });
      if (res.status === 429) {
        // Сервер теперь отдаёт user-facing текст в `message`, а `error` —
        // это стабильный код ("rate_limited"). Читаем оба: сначала message,
        // потом старый error для обратной совместимости со старыми сборками.
        const data = await res.json().catch(() => ({}));
        Alert.alert('Кулдаун', data.message ?? data.error ?? 'Подожди немного');
        navigation.goBack();
        return;
      }
      const data = await res.json();
      setBattleResult(data);
      const isWin = data.battle.result === 'attacker';
      playClashAnimation(isWin);
    } catch (e) {
      Alert.alert('Ошибка', 'Бой не удался');
      navigation.goBack();
    }
  }, [params.opponentUserId]);

  // === CHALLENGE MODE — navigate to ExerciseTracker ===
  const startChallenge = useCallback(async () => {
    if (mana < 20) {
      Alert.alert('Мало маны!', 'Нужно минимум 20 маны. Выполняй задачи чтобы её получить!');
      return;
    }
    try {
      const res = await fetch(`${API}/challenge/create`, {
        method: 'POST', headers,
        body: JSON.stringify({ opponentUserId: params.opponentUserId }),
      });
      const data = await res.json();
      if (data.error) { Alert.alert('Ошибка', data.error); return; }
      setMana(data.manaRemaining);
      // Navigate to exercise tracker
      (navigation as any).navigate('ExerciseTracker', {
        challengeId: data.challenge.id,
        exercise: data.challenge.exercise,
        exerciseName: data.challenge.exerciseName,
        targetReps: data.challenge.attackerTarget,
        unit: data.challenge.unit,
        opponentName: params.opponentName,
        opponentTarget: data.challenge.defenderTarget,
      });
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось создать челлендж');
    }
  }, [mana, params.opponentUserId, navigation]);

  // (challenge timer moved to ExerciseTracker screen)

  // === RENDER ===
  const resultColor = battleResult?.battle.result === 'attacker' ? '#4CAF50'
    : battleResult?.battle.result === 'draw' ? '#FF9800' : '#F44336';

  return (
    <View style={[styles.container, { backgroundColor: arena.sky }]}>
      {/* Arena name */}
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <Text style={[styles.arenaName, { color: arena.accent }]}>{arena.name}</Text>
        {phase === 'enter' && <Text style={styles.phaseText}>Выход на арену...</Text>}
        {phase === 'face-off' && <Text style={styles.phaseText}>Противники готовы!</Text>}
        {phase === 'clash' && <Text style={[styles.phaseText, { color: '#FF5722' }]}>⚔️ БИТВА!</Text>}
      </SafeAreaView>

      {/* === ARENA GROUND === */}
      <Animated.View style={[styles.arenaGround, {
        backgroundColor: arena.ground,
        borderColor: arena.accent + '40',
        transform: [{ scale: groundPulse }],
      }]}>
        {/* Ground pattern lines */}
        <View style={[styles.groundLine, { backgroundColor: arena.accent + '15', top: '30%' }]} />
        <View style={[styles.groundLine, { backgroundColor: arena.accent + '15', top: '50%' }]} />
        <View style={[styles.groundLine, { backgroundColor: arena.accent + '15', top: '70%' }]} />
        <View style={[styles.groundCircle, { borderColor: arena.accent + '20' }]} />
      </Animated.View>

      {/* === CHARACTERS ON ARENA === */}
      <View style={styles.battleField}>
        {/* Left character (me) */}
        <Animated.View style={[styles.charContainer, {
          transform: [
            { translateX: leftWalkX },
            { translateY: leftBounce },
            { translateX: leftShake },
          ],
        }]}>
          <View style={styles.charLabel}>
            <Text style={styles.charName}>{params.myName}</Text>
            <Text style={styles.charPower}>⚡{Math.round(params.myPower)}</Text>
          </View>
          <CharacterRenderer character={myCharConfig} size={110} level={params.myLevel} showGlow />
          <Text style={styles.charLevelBadge}>Lv.{params.myLevel}</Text>
        </Animated.View>

        {/* VS indicator */}
        <View style={styles.vsContainer}>
          {phase === 'face-off' && (
            <Text style={[styles.vsText, { color: arena.accent }]}>VS</Text>
          )}
          {/* Clash explosion effect */}
          <Animated.View style={[styles.clashEffect, {
            opacity: clashOpacity,
            transform: [{ scale: clashScale }],
          }]}>
            <Text style={styles.clashEmoji}>💥</Text>
          </Animated.View>
          {/* Sparkles */}
          <Animated.View style={[styles.sparkle, styles.sparkle1, { opacity: starSparkle }]}>
            <Text style={{ fontSize: 16 }}>✨</Text>
          </Animated.View>
          <Animated.View style={[styles.sparkle, styles.sparkle2, { opacity: starSparkle }]}>
            <Text style={{ fontSize: 14 }}>⭐</Text>
          </Animated.View>
          <Animated.View style={[styles.sparkle, styles.sparkle3, { opacity: starSparkle }]}>
            <Text style={{ fontSize: 12 }}>💫</Text>
          </Animated.View>
        </View>

        {/* Right character (opponent) */}
        <Animated.View style={[styles.charContainer, {
          transform: [
            { translateX: rightWalkX },
            { translateY: rightBounce },
            { translateX: rightShake },
          ],
        }]}>
          <View style={styles.charLabel}>
            <Text style={styles.charName}>{params.opponentName}</Text>
            <Text style={styles.charPower}>⚡{Math.round(params.opponentPower)}</Text>
          </View>
          <CharacterRenderer character={opCharConfig} size={110} level={params.opponentLevel} showGlow />
          <Text style={styles.charLevelBadge}>Lv.{params.opponentLevel}</Text>
        </Animated.View>
      </View>

      {/* === RESULT PANEL === */}
      {phase === 'result' && battleResult && (
        <Animated.View style={[styles.resultPanel, {
          borderColor: resultColor,
          transform: [{ translateY: resultSlide }],
          opacity: resultOpacity,
        }]}>
          <Text style={[styles.resultTitle, { color: resultColor }]}>
            {battleResult.battle.result === 'attacker' ? '🎉 ПОБЕДА!'
              : battleResult.battle.result === 'draw' ? '🤝 НИЧЬЯ' : '💀 ПОРАЖЕНИЕ'}
          </Text>
          <Text style={styles.resultLog}>{battleResult.battle.log}</Text>

          <View style={styles.resultRow}>
            <View style={styles.resultStat}>
              <Text style={[styles.resultValue, { color: resultColor }]}>
                {battleResult.battle.trophyChange >= 0 ? '+' : ''}{battleResult.battle.trophyChange}
              </Text>
              <Text style={styles.resultLabel}>🏆 Трофеи</Text>
            </View>
            <View style={styles.resultStat}>
              <Text style={[styles.resultValue, { color: '#7ECFC0' }]}>
                +{battleResult.battle.xpReward}
              </Text>
              <Text style={styles.resultLabel}>✨ Опыт</Text>
            </View>
          </View>

          {/* Mana challenge button */}
          <View style={styles.challengeSection}>
            <Text style={styles.manaDisplay}>🔮 Мана: {mana}/100</Text>
            {mana >= 20 ? (
              <TouchableOpacity style={styles.challengeButton} onPress={startChallenge} activeOpacity={0.8}>
                <Text style={styles.challengeButtonText}>💪 Физический Челлендж (20 маны)</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.noManaText}>Мало маны — выполняй задачи!</Text>
            )}
          </View>

          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={styles.backButtonText}>Вернуться на арену</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Challenge mode now handled by ExerciseTracker screen */}
    </View>
  );
}

function createStyles(cl: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1 },
    topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, alignItems: 'center', paddingTop: 8 },
    arenaName: { fontSize: fontSize.lg, fontWeight: '900', letterSpacing: 2 },
    phaseText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700', marginTop: 4 },

    // Arena ground
    arenaGround: {
      position: 'absolute', bottom: '15%', left: '5%', right: '5%',
      height: '35%', borderRadius: 20, borderWidth: 1,
      overflow: 'hidden',
    },
    groundLine: { position: 'absolute', left: 0, right: 0, height: 1 },
    groundCircle: {
      position: 'absolute', top: '20%', left: '25%', width: '50%', height: '60%',
      borderRadius: 999, borderWidth: 1,
    },

    // Battle field
    battleField: {
      position: 'absolute', top: '25%', left: 0, right: 0,
      flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
      paddingHorizontal: spacing.md,
    },
    charContainer: { alignItems: 'center', width: 130 },
    charLabel: { alignItems: 'center', marginBottom: 6 },
    charName: { color: '#fff', fontSize: fontSize.sm, fontWeight: '700' },
    charPower: { color: '#FFD700', fontSize: fontSize.xs, fontWeight: '600' },
    charLevelBadge: {
      color: '#fff', fontSize: fontSize.xs - 1, fontWeight: '800',
      backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 8,
      paddingVertical: 2, borderRadius: 8, marginTop: 4,
    },

    // VS & clash
    vsContainer: { alignItems: 'center', justifyContent: 'center', width: 60 },
    vsText: { fontSize: 32, fontWeight: '900' },
    clashEffect: { position: 'absolute' },
    clashEmoji: { fontSize: 50 },
    sparkle: { position: 'absolute' },
    sparkle1: { top: -30, left: -20 },
    sparkle2: { top: -20, right: -25 },
    sparkle3: { bottom: -25, left: 5 },

    // Result panel
    resultPanel: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: cl.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      borderTopWidth: 3, padding: spacing.lg, paddingBottom: spacing.xl * 2,
      alignItems: 'center',
    },
    resultTitle: { fontSize: fontSize.xl + 4, fontWeight: '900', marginBottom: 8 },
    resultLog: { color: cl.textSecondary, fontSize: fontSize.sm, textAlign: 'center', marginBottom: 12 },
    resultRow: { flexDirection: 'row', gap: spacing.xl, marginBottom: spacing.lg },
    resultStat: { alignItems: 'center' },
    resultValue: { fontSize: fontSize.lg, fontWeight: '900' },
    resultLabel: { color: cl.textSecondary, fontSize: fontSize.xs, marginTop: 2 },

    // Challenge section in result
    challengeSection: { alignItems: 'center', marginBottom: spacing.md },
    manaDisplay: { color: '#9C27B0', fontSize: fontSize.md, fontWeight: '700', marginBottom: 8 },
    challengeButton: {
      backgroundColor: '#9C27B0', paddingHorizontal: 20, paddingVertical: 12,
      borderRadius: borderRadius.lg,
    },
    challengeButtonText: { color: '#fff', fontSize: fontSize.sm, fontWeight: '800' },
    noManaText: { color: cl.textSecondary, fontSize: fontSize.sm, fontStyle: 'italic' },
    backButton: {
      backgroundColor: cl.surfaceLight, paddingHorizontal: 24, paddingVertical: 12,
      borderRadius: borderRadius.lg, marginTop: 8,
    },
    backButtonText: { color: cl.text, fontSize: fontSize.sm, fontWeight: '700' },
  });
}
