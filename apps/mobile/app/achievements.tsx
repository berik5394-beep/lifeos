import React, { useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/ui';
import { useAchievementStore } from '@/stores/achievement-store';
import type { Achievement, ThemeInfo } from '@/stores/achievement-store';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';

const TYPE_ICONS: Record<string, string> = {
  costume: '👕',
  badge: '🏅',
  secret_pet: '🐉',
  theme: '🎨',
};

const TYPE_LABELS: Record<string, string> = {
  costume: 'Костюмы',
  badge: 'Бейджи',
  secret_pet: 'Секретные питомцы',
  theme: 'Темы',
};

const SECTION_ORDER = ['costume', 'badge', 'secret_pet', 'theme'];

interface AchievementCardProps {
  achievement: Achievement;
  onClaim: (key: string) => void;
}

const AchievementCard = React.memo(function AchievementCard({
  achievement,
  onClaim,
}: AchievementCardProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const icon = TYPE_ICONS[achievement.type] ?? '🏆';
  const isUnlocked = achievement.unlocked;
  const isClaimed = achievement.claimed;

  return (
    <Card style={[styles.achievementCard, !isUnlocked ? styles.achievementCardLocked : undefined]}>
      <View style={styles.achievementRow}>
        <Text style={[styles.achievementIcon, !isUnlocked && styles.achievementIconLocked]}>
          {isUnlocked ? icon : '🔒'}
        </Text>
        <View style={styles.achievementInfo}>
          <Text style={[styles.achievementName, !isUnlocked && styles.achievementNameLocked]}>
            {achievement.name}
          </Text>
          {achievement.description ? (
            <Text style={styles.achievementDescription}>{achievement.description}</Text>
          ) : null}
        </View>
        <View style={styles.achievementAction}>
          {isUnlocked && !isClaimed ? (
            <Button title="Забрать" onPress={() => onClaim(achievement.key)} size="sm" />
          ) : null}
          {isClaimed ? (
            <Text style={styles.claimedLabel}>Получено ✓</Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
});

interface ThemeCardProps {
  theme: ThemeInfo;
  onActivate: (key: string) => void;
}

const ThemeCard = React.memo(function ThemeCard({ theme, onActivate }: ThemeCardProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <Card style={[styles.achievementCard, !theme.unlocked ? styles.achievementCardLocked : undefined]}>
      <View style={styles.achievementRow}>
        <Text style={[styles.achievementIcon, !theme.unlocked && styles.achievementIconLocked]}>
          {theme.unlocked ? '🎨' : '🔒'}
        </Text>
        <View style={styles.achievementInfo}>
          <Text style={[styles.achievementName, !theme.unlocked && styles.achievementNameLocked]}>
            {theme.name}
          </Text>
        </View>
        <View style={styles.achievementAction}>
          {theme.unlocked && !theme.active ? (
            <Button title="Включить" onPress={() => onActivate(theme.key)} size="sm" />
          ) : null}
          {theme.active ? (
            <Text style={styles.claimedLabel}>Активна ✓</Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
});

export default function AchievementsScreen() {
  const navigation = useNavigation<any>();
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const {
    achievements,
    themes,
    isLoading,
    fetchAchievements,
    claimAchievement,
    fetchThemes,
    setActiveTheme,
  } = useAchievementStore();

  useEffect(() => {
    fetchAchievements();
    fetchThemes();
  }, [fetchAchievements, fetchThemes]);

  // Safe back navigation — if there's no history (e.g. after modal dismiss),
  // fall back to the Dashboard instead of producing a white screen.
  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Tabs' as never);
    }
  }, [navigation]);

  const handleClaim = useCallback(
    async (key: string) => {
      await claimAchievement(key);
    },
    [claimAchievement],
  );

  const handleActivateTheme = useCallback(
    async (key: string) => {
      await setActiveTheme(key);
    },
    [setActiveTheme],
  );

  // Group achievements by type
  const grouped = (achievements || []).reduce<Record<string, Achievement[]>>((acc, a) => {
    if (!acc[a.type]) {
      acc[a.type] = [];
    }
    acc[a.type].push(a);
    return acc;
  }, {});

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <TouchableOpacity
          onPress={handleBack}
          activeOpacity={0.7}
          style={styles.backButton}
        >
          <Text style={styles.backText}>{'\u2190'} Назад</Text>
        </TouchableOpacity>
        <SectionHeader title="Достижения" subtitle="Награды, бейджи и темы" />

        {isLoading ? (
          <View style={styles.centered}>
            <Text style={styles.loadingText}>Загрузка...</Text>
          </View>
        ) : (
          <>
            {/* Achievement sections */}
            {SECTION_ORDER.map((type) => {
              const items = grouped[type];
              if (!items || items.length === 0) return null;

              return (
                <View key={type} style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    {TYPE_ICONS[type] ?? '🏆'} {TYPE_LABELS[type] ?? type}
                  </Text>
                  {items.map((achievement) => (
                    <AchievementCard
                      key={achievement.key}
                      achievement={achievement}
                      onClaim={handleClaim}
                    />
                  ))}
                </View>
              );
            })}

            {/* Themes section */}
            {(themes || []).length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>🎨 Темы</Text>
                {themes.map((theme) => (
                  <ThemeCard
                    key={theme.key}
                    theme={theme}
                    onActivate={handleActivateTheme}
                  />
                ))}
              </View>
            ) : null}

            {/* Empty state */}
            {(achievements || []).length === 0 && (themes || []).length === 0 ? (
              <View style={styles.centered}>
                <Text style={styles.emptyIcon}>🏆</Text>
                <Text style={styles.emptyText}>
                  Достижения ещё не загружены
                </Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 3,
  },
  backButton: {
    marginBottom: spacing.sm,
  },
  backText: {
    color: c.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
  },
  loadingText: {
    color: c.textSecondary,
    fontSize: fontSize.md,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyText: {
    color: c.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
  },

  // Section
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    color: c.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },

  // Achievement card
  achievementCard: {
    marginBottom: spacing.sm,
  },
  achievementCardLocked: {
    opacity: 0.5,
  },
  achievementRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  achievementIcon: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  achievementIconLocked: {
    opacity: 0.5,
  },
  achievementInfo: {
    flex: 1,
  },
  achievementName: {
    color: c.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  achievementNameLocked: {
    color: c.textSecondary,
  },
  achievementDescription: {
    color: c.textSecondary,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  achievementAction: {
    marginLeft: spacing.sm,
  },
  claimedLabel: {
    color: c.success,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  });
}
