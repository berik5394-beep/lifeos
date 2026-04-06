import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PetAvatar } from '@/components/shared/pet-avatar';
import { usePetStore } from '@/stores/pet-store';
import type { PetState } from '@/stores/pet-store';
import { colors, spacing, fontSize, borderRadius } from '@/constants';

const STATE_LABELS: Record<PetState, string> = {
  happy: '\u0421\u0447\u0430\u0441\u0442\u043B\u0438\u0432\u044B\u0439',
  content: '\u0414\u043E\u0432\u043E\u043B\u044C\u043D\u044B\u0439',
  normal: '\u041D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u044B\u0439',
  sad: '\u0413\u0440\u0443\u0441\u0442\u043D\u044B\u0439',
  sick: '\u0411\u043E\u043B\u0435\u0435\u0442',
  hungry: '\u0413\u043E\u043B\u043E\u0434\u043D\u044B\u0439',
  sleepy: '\u0421\u043E\u043D\u043D\u044B\u0439',
  sleeping: '\u0421\u043F\u0438\u0442',
  celebrating: '\u041F\u0440\u0430\u0437\u0434\u043D\u0443\u0435\u0442',
  exercising: '\u0422\u0440\u0435\u043D\u0438\u0440\u0443\u0435\u0442\u0441\u044F',
};

interface BreakdownCardProps {
  label: string;
  value: number;
  max: number;
  icon: string;
}

const BreakdownCard = React.memo(function BreakdownCard({
  label,
  value,
  max,
  icon,
}: BreakdownCardProps) {
  const progress = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <View style={styles.breakdownCard}>
      <Text style={styles.breakdownIcon}>{icon}</Text>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <View style={styles.breakdownBarBg}>
        <View
          style={[
            styles.breakdownBarFill,
            { width: `${progress * 100}%` },
          ]}
        />
      </View>
      <Text style={styles.breakdownValue}>
        {value}/{max}
      </Text>
    </View>
  );
});

export default function PetScreen() {
  const router = useRouter();
  const { petData, isLoading, lastReaction, fetchPet, feedPet, playWithPet, renamePet } =
    usePetStore();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  useEffect(() => {
    fetchPet();
  }, [fetchPet]);

  const handleNamePress = useCallback(() => {
    if (petData) {
      setNameInput(petData.pet.name);
      setIsEditingName(true);
    }
  }, [petData]);

  const handleNameSubmit = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (trimmed && petData && trimmed !== petData.pet.name) {
      await renamePet(trimmed);
    }
    setIsEditingName(false);
  }, [nameInput, petData, renamePet]);

  const handleFeed = useCallback(async () => {
    await feedPet();
  }, [feedPet]);

  const handlePlay = useCallback(async () => {
    await playWithPet();
  }, [playWithPet]);

  if (isLoading || !petData) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>
            {isLoading ? '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...' : '\u041F\u0438\u0442\u043E\u043C\u0435\u0446 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const { pet, state, healthBreakdown } = petData;
  const healthPercent = Math.min(Math.max(pet.health, 0), 100);
  const happinessPercent = Math.min(Math.max(pet.happiness, 0), 100);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Back button */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Text style={styles.backText}>{'\u2190'} \u041D\u0430\u0437\u0430\u0434</Text>
        </TouchableOpacity>

        {/* Pet Display */}
        <View style={styles.petSection}>
          <PetAvatar
            petType={pet.type}
            state={state}
            costume={pet.costume}
            size={120}
            reaction={lastReaction}
          />

          {/* Name */}
          {isEditingName ? (
            <TextInput
              style={styles.nameInput}
              value={nameInput}
              onChangeText={setNameInput}
              onSubmitEditing={handleNameSubmit}
              onBlur={handleNameSubmit}
              returnKeyType="done"
              autoFocus
              maxLength={20}
              placeholderTextColor={colors.textSecondary}
            />
          ) : (
            <TouchableOpacity onPress={handleNamePress} activeOpacity={0.7}>
              <Text style={styles.petName}>{pet.name}</Text>
            </TouchableOpacity>
          )}

          {/* State label */}
          <Text style={styles.stateLabel}>{STATE_LABELS[state]}</Text>

          {/* Streak */}
          {pet.streak > 0 ? (
            <Text style={styles.streakText}>
              {'\u{1F525}'} {pet.streak} \u0434\u043D\u0435\u0439 \u043F\u043E\u0434\u0440\u044F\u0434
            </Text>
          ) : null}
        </View>

        {/* Health bar */}
        <Card style={styles.statCard}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>
              {'\u2764\uFE0F'} \u0417\u0434\u043E\u0440\u043E\u0432\u044C\u0435
            </Text>
            <Text style={styles.statValue}>{healthPercent}%</Text>
          </View>
          <View style={styles.barBg}>
            <View
              style={[
                styles.barFill,
                styles.healthBar,
                { width: `${healthPercent}%` },
              ]}
            />
          </View>
        </Card>

        {/* Happiness bar */}
        <Card style={styles.statCard}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>
              {'\u{1F60A}'} \u0421\u0447\u0430\u0441\u0442\u044C\u0435
            </Text>
            <Text style={styles.statValue}>{happinessPercent}%</Text>
          </View>
          <View style={styles.barBg}>
            <View
              style={[
                styles.barFill,
                styles.happinessBar,
                { width: `${happinessPercent}%` },
              ]}
            />
          </View>
        </Card>

        {/* Health Breakdown */}
        <Text style={styles.sectionTitle}>
          {'\u{1F4CA}'} \u0421\u043E\u0441\u0442\u0430\u0432 \u0437\u0434\u043E\u0440\u043E\u0432\u044C\u044F
        </Text>
        <View style={styles.breakdownGrid}>
          <BreakdownCard
            label="\u041F\u0440\u0438\u0432\u044B\u0447\u043A\u0438"
            value={healthBreakdown.habits}
            max={30}
            icon={'\u{1F3AF}'}
          />
          <BreakdownCard
            label="\u0417\u0430\u0434\u0430\u0447\u0438"
            value={healthBreakdown.tasks}
            max={25}
            icon={'\u2705'}
          />
          <BreakdownCard
            label="\u0411\u044E\u0434\u0436\u0435\u0442"
            value={healthBreakdown.budget}
            max={15}
            icon={'\u{1F4B0}'}
          />
          <BreakdownCard
            label="\u0428\u0430\u0433\u0438"
            value={healthBreakdown.steps}
            max={10}
            icon={'\u{1F6B6}'}
          />
          <BreakdownCard
            label="\u0414\u043D\u0435\u0432\u043D\u0438\u043A"
            value={healthBreakdown.journal}
            max={10}
            icon={'\u{1F4DD}'}
          />
          <BreakdownCard
            label="\u0415\u0434\u0430"
            value={healthBreakdown.meals}
            max={10}
            icon={'\u{1F34E}'}
          />
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <Button
            title={'\u{1F34E} \u041F\u043E\u043A\u043E\u0440\u043C\u0438\u0442\u044C'}
            onPress={handleFeed}
            size="lg"
            style={styles.actionButton}
          />
          <Button
            title={'\u{1F3AE} \u041F\u043E\u0438\u0433\u0440\u0430\u0442\u044C'}
            onPress={handlePlay}
            size="lg"
            variant="outline"
            style={styles.actionButton}
          />
        </View>

        {/* Costume */}
        {pet.costume ? (
          <Card style={styles.costumeCard}>
            <Text style={styles.costumeLabel}>
              {'\u{1F457}'} \u041A\u043E\u0441\u0442\u044E\u043C: {pet.costume}
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 3,
  },
  backButton: {
    marginBottom: spacing.md,
  },
  backText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  petSection: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    paddingVertical: spacing.lg,
  },
  petName: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  nameInput: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginTop: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minWidth: 120,
    textAlign: 'center',
  },
  stateLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  streakText: {
    color: colors.warning,
    fontSize: fontSize.md,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  statCard: {
    marginBottom: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  statLabel: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  statValue: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  barBg: {
    height: 10,
    backgroundColor: colors.surfaceLight,
    borderRadius: 5,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
  },
  healthBar: {
    backgroundColor: colors.success,
  },
  happinessBar: {
    backgroundColor: colors.warning,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  breakdownGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  breakdownCard: {
    width: '31%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center',
    minHeight: 90,
  },
  breakdownIcon: {
    fontSize: 20,
    marginBottom: spacing.xs,
  },
  breakdownLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  breakdownBarBg: {
    width: '100%',
    height: 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  breakdownBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  breakdownValue: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  actionButton: {
    flex: 1,
  },
  costumeCard: {
    marginBottom: spacing.md,
  },
  costumeLabel: {
    color: colors.text,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
});
