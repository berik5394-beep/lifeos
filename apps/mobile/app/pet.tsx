import React, { useCallback, useEffect, useState , useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PetAvatar } from '@/components/shared/pet-avatar';
import { usePetStore } from '@/stores/pet-store';
import type { PetState, PetStage, ReviveMethod, CostumeInfo } from '@/stores/pet-store';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';

const STATE_LABELS: Record<PetState, string> = {
  happy: 'Счастливый',
  content: 'Довольный',
  normal: 'Нормальный',
  sad: 'Грустный',
  sick: 'Болеет',
  hungry: 'Голодный',
  sleepy: 'Сонный',
  sleeping: 'Спит',
  celebrating: 'Празднует',
  exercising: 'Тренируется',
  dead: 'Мёртв',
};

const STAGE_LABELS: Record<PetStage, string> = {
  baby: 'Малыш',
  teen: 'Подросток',
  adult: 'Взрослый',
  master: 'Мастер',
  legend: 'Легенда',
};

const STAGE_SIZES: Record<PetStage, number> = {
  baby: 80,
  teen: 100,
  adult: 120,
  master: 140,
  legend: 160,
};

const ROOM_DECORATIONS: Record<number, string[]> = {
  1: [],
  2: ['🪑', '📦'],
  3: ['🛋️', '🖼️', '🪴'],
  4: ['🏆', '✨', '💎'],
  5: ['👑', '🏰', '✨', '💫'],
};

const ROOM_COLORS: Record<number, string> = {
  1: '#1a1a2e',
  2: '#16213e',
  3: '#1a1a3e',
  4: '#1e1040',
  5: '#2a1050',
};

interface ReviveOption {
  method: ReviveMethod;
  icon: string;
  title: string;
  description: string;
}

const REVIVE_OPTIONS: ReviveOption[] = [
  {
    method: 'perfect_day',
    icon: '🌟',
    title: '100% за сегодня',
    description: 'Выполни все привычки и задачи',
  },
  {
    method: 'double_steps',
    icon: '🏃',
    title: 'Двойная норма шагов',
    description: 'Пройди 20 000 шагов',
  },
  {
    method: 'three_days',
    icon: '📅',
    title: '3 дня по 80%',
    description: 'Выполняй 80%+ три дня подряд',
  },
];

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
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
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

interface ReviveCardProps {
  option: ReviveOption;
  onPress: (method: ReviveMethod) => void;
}

const ReviveCard = React.memo(function ReviveCard({ option, onPress }: ReviveCardProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <TouchableOpacity
      style={styles.reviveCard}
      onPress={() => onPress(option.method)}
      activeOpacity={0.7}
    >
      <Text style={styles.reviveIcon}>{option.icon}</Text>
      <View style={styles.reviveTextContainer}>
        <Text style={styles.reviveTitle}>{option.title}</Text>
        <Text style={styles.reviveDescription}>{option.description}</Text>
      </View>
    </TouchableOpacity>
  );
});

interface CostumeItemProps {
  costume: CostumeInfo;
  onEquip: (key: string) => void;
}

const CostumeItem = React.memo(function CostumeItem({ costume, onEquip }: CostumeItemProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <View style={[styles.costumeItem, !costume.unlocked && styles.costumeItemLocked]}>
      <Text style={styles.costumeEmoji}>{costume.emoji}</Text>
      <Text style={[styles.costumeName, !costume.unlocked && styles.costumeNameLocked]}>
        {costume.name}
      </Text>
      {costume.unlocked ? (
        costume.equipped ? (
          <Text style={styles.costumeEquipped}>Надето</Text>
        ) : (
          <Button title="Надеть" onPress={() => onEquip(costume.key)} size="sm" />
        )
      ) : (
        <Text style={styles.costumeLocked}>🔒</Text>
      )}
    </View>
  );
});

export default function PetScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
  const {
    petData,
    costumes,
    isLoading,
    lastReaction,
    fetchPet,
    feedPet,
    playWithPet,
    renamePet,
    revivePet,
    fetchCostumes,
    setCostume,
  } = usePetStore();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [costumeModalVisible, setCostumeModalVisible] = useState(false);

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

  const handleRevive = useCallback(
    async (method: ReviveMethod) => {
      await revivePet(method);
    },
    [revivePet],
  );

  const handleOpenCostumes = useCallback(async () => {
    await fetchCostumes();
    setCostumeModalVisible(true);
  }, [fetchCostumes]);

  const handleEquipCostume = useCallback(
    async (costume: string) => {
      await setCostume(costume);
      setCostumeModalVisible(false);
    },
    [setCostume],
  );

  if (isLoading || !petData) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>
            {isLoading ? 'Загрузка...' : 'Питомец не найден'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const { pet, state } = petData;
  const healthBreakdown = petData.healthBreakdown ?? {
    habits: 0, tasks: 0, budget: 0, steps: 0, journal: 0, meals: 0,
  };

  // Death screen
  if (!pet.isAlive) {
    return (
      <SafeAreaView style={styles.deathContainer} edges={['top']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.deathContent}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Text style={styles.backTextDeath}>{'\u2190'} Назад</Text>
          </TouchableOpacity>

          <View style={styles.deathPetSection}>
            <View style={styles.deathPetWrapper}>
              <PetAvatar
                petType={pet.type}
                state="dead"
                costume={null}
                size={120}
                stage={pet.stage}
              />
            </View>

            <Text style={styles.deathTitle}>
              {pet.name} не выдержал...
            </Text>
            <Text style={styles.deathSubtitle}>
              Он ждал тебя, но ты не пришёл.
            </Text>
          </View>

          <Text style={styles.reviveSectionTitle}>Как воскресить</Text>

          {REVIVE_OPTIONS.map((option) => (
            <ReviveCard key={option.method} option={option} onPress={handleRevive} />
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Alive pet room
  const healthPercent = Math.min(Math.max(pet.health, 0), 100);
  const happinessPercent = Math.min(Math.max(pet.happiness, 0), 100);
  const petSize = STAGE_SIZES[pet.stage] ?? 120;
  const roomLevel = Math.min(Math.max(pet.roomLevel, 1), 5) as 1 | 2 | 3 | 4 | 5;
  const decorations = ROOM_DECORATIONS[roomLevel] ?? [];
  const roomBg = ROOM_COLORS[roomLevel] ?? ROOM_COLORS[1];
  const xpPercent = pet.xpToNext > 0 ? Math.min((pet.xp / pet.xpToNext) * 100, 100) : 0;

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
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.backText}>{'\u2190'} Назад</Text>
        </TouchableOpacity>

        {/* Room background with decorations */}
        <View style={[styles.roomContainer, { backgroundColor: roomBg }]}>
          {/* Room decorations */}
          {decorations.length > 0 && (
            <View style={styles.decorationsRow}>
              {decorations.map((deco, idx) => (
                <Text key={`deco-${idx}`} style={styles.decorationEmoji}>
                  {deco}
                </Text>
              ))}
            </View>
          )}

          {/* Pet center */}
          <View style={styles.petCenter}>
            {pet.stage === 'master' && <View style={styles.glowEffect} />}
            {pet.stage === 'legend' && <View style={styles.goldenBorder} />}
            <PetAvatar
              petType={pet.type}
              state={state}
              costume={pet.costume}
              size={petSize}
              reaction={lastReaction}
              stage={pet.stage}
            />
          </View>

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
              placeholderTextColor={c.textSecondary}
            />
          ) : (
            <TouchableOpacity onPress={handleNamePress} activeOpacity={0.7}>
              <Text style={styles.petName}>{pet.name}</Text>
            </TouchableOpacity>
          )}

          {/* State label */}
          <Text style={styles.stateLabel}>{STATE_LABELS[state]}</Text>
        </View>

        {/* Level & XP */}
        <Card style={styles.levelCard}>
          <Text style={styles.levelTitle}>
            Уровень {pet.level} {'\u2022'} {STAGE_LABELS[pet.stage]}
          </Text>
          <View style={styles.xpBarBg}>
            <View style={[styles.xpBarFill, { width: `${xpPercent}%` }]} />
          </View>
          <Text style={styles.xpText}>
            {pet.xp}/{pet.xpToNext} XP
          </Text>
        </Card>

        {/* Health bar */}
        <Card style={styles.statCard}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>
              {'\u2764\uFE0F'} Здоровье
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
              {'\u{1F60A}'} Счастье
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

        {/* Streak */}
        {pet.streak > 0 ? (
          <Card style={styles.streakCard}>
            <Text style={styles.streakText}>
              {'\u{1F525}'} {pet.streak} дней подряд
            </Text>
          </Card>
        ) : null}

        {/* Health Breakdown */}
        <Text style={styles.sectionTitle}>
          {'\u{1F4CA}'} Состав здоровья
        </Text>
        <View style={styles.breakdownGrid}>
          <BreakdownCard label="Привычки" value={healthBreakdown.habits} max={30} icon={'\u{1F3AF}'} />
          <BreakdownCard label="Задачи" value={healthBreakdown.tasks} max={25} icon={'\u2705'} />
          <BreakdownCard label="Бюджет" value={healthBreakdown.budget} max={15} icon={'\u{1F4B0}'} />
          <BreakdownCard label="Шаги" value={healthBreakdown.steps} max={10} icon={'\u{1F6B6}'} />
          <BreakdownCard label="Дневник" value={healthBreakdown.journal} max={10} icon={'\u{1F4DD}'} />
          <BreakdownCard label="Еда" value={healthBreakdown.meals} max={10} icon={'\u{1F34E}'} />
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <Button title={'🍎 Покормить'} onPress={handleFeed} size="lg" style={styles.actionButton} />
          <Button title={'🎮 Поиграть'} onPress={handlePlay} size="lg" variant="outline" style={styles.actionButton} />
        </View>
        <View style={styles.actionsRow}>
          <Button title={'👕 Костюмы'} onPress={handleOpenCostumes} size="lg" variant="secondary" style={styles.actionButton} />
          <Button
            title={'🏆 Достижения'}
            onPress={() => navigation.navigate('Achievements' as never)}
            size="lg"
            variant="secondary"
            style={styles.actionButton}
          />
        </View>
        <View style={styles.actionsRow}>
          <Button
            title={'⚔️ Персонаж'}
            onPress={() => navigation.navigate('character-select' as never)}
            size="lg"
            variant="secondary"
            style={styles.actionButton}
          />
          <Button
            title={'🏟️ Арена'}
            onPress={() => navigation.navigate('Arena' as never)}
            size="lg"
            variant="secondary"
            style={styles.actionButton}
          />
        </View>

        {/* Current costume */}
        {pet.costume ? (
          <Card style={styles.costumeCard}>
            <Text style={styles.costumeLabel}>
              {'\u{1F457}'} Костюм: {pet.costume}
            </Text>
          </Card>
        ) : null}
      </ScrollView>

      {/* Costume Modal */}
      <Modal
        visible={costumeModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setCostumeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Костюмы</Text>
              <TouchableOpacity onPress={() => setCostumeModalVisible(false)} activeOpacity={0.7}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={costumes}
              keyExtractor={(item) => item.key}
              renderItem={({ item }) => (
                <CostumeItem costume={item} onEquip={handleEquipCostume} />
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>Нет доступных костюмов</Text>
              }
              style={styles.costumeList}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  deathContainer: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: c.textSecondary,
    fontSize: fontSize.md,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 3,
  },
  deathContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 3,
  },
  backButton: {
    marginBottom: spacing.md,
  },
  backText: {
    color: c.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  backTextDeath: {
    color: '#666',
    fontSize: fontSize.md,
    fontWeight: '600',
  },

  // Death screen
  deathPetSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    paddingVertical: spacing.xl,
  },
  deathPetWrapper: {
    opacity: 0.5,
    marginBottom: spacing.lg,
  },
  deathTitle: {
    color: '#888',
    fontSize: fontSize.xl,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  deathSubtitle: {
    color: '#555',
    fontSize: fontSize.md,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  reviveSectionTitle: {
    color: '#777',
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  reviveCard: {
    backgroundColor: '#1a1a24',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  reviveIcon: {
    fontSize: 32,
    marginRight: spacing.md,
  },
  reviveTextContainer: {
    flex: 1,
  },
  reviveTitle: {
    color: '#ccc',
    fontSize: fontSize.md,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  reviveDescription: {
    color: '#777',
    fontSize: fontSize.sm,
  },

  // Room
  roomContainer: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
    minHeight: 280,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  decorationsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    position: 'absolute',
    top: spacing.md,
    paddingHorizontal: spacing.md,
  },
  decorationEmoji: {
    fontSize: 28,
  },
  petCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  glowEffect: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
  },
  goldenBorder: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 3,
    borderColor: '#FFD700',
    backgroundColor: 'rgba(255, 215, 0, 0.05)',
  },
  petName: {
    color: c.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
    textAlign: 'center',
  },
  nameInput: {
    color: c.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
    borderBottomWidth: 2,
    borderBottomColor: c.primary,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minWidth: 120,
    textAlign: 'center',
  },
  stateLabel: {
    color: c.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },

  // Level & XP
  levelCard: {
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  levelTitle: {
    color: c.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  xpBarBg: {
    width: '100%',
    height: 8,
    backgroundColor: c.surfaceLight,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  xpBarFill: {
    height: '100%',
    backgroundColor: c.secondary,
    borderRadius: 4,
  },
  xpText: {
    color: c.textSecondary,
    fontSize: fontSize.xs,
  },

  // Stats
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
    color: c.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  statValue: {
    color: c.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  barBg: {
    height: 10,
    backgroundColor: c.surfaceLight,
    borderRadius: 5,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
  },
  healthBar: {
    backgroundColor: c.success,
  },
  happinessBar: {
    backgroundColor: c.warning,
  },

  // Streak
  streakCard: {
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  streakText: {
    color: c.warning,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },

  // Breakdown
  sectionTitle: {
    color: c.text,
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
    backgroundColor: c.surface,
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
    color: c.textSecondary,
    fontSize: fontSize.xs,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  breakdownBarBg: {
    width: '100%',
    height: 4,
    backgroundColor: c.surfaceLight,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  breakdownBarFill: {
    height: '100%',
    backgroundColor: c.primary,
    borderRadius: 2,
  },
  breakdownValue: {
    color: c.text,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },

  // Actions
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },

  // Costume card
  costumeCard: {
    marginBottom: spacing.md,
  },
  costumeLabel: {
    color: c.text,
    fontSize: fontSize.md,
    textAlign: 'center',
  },

  // Costume modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: c.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '70%',
    paddingBottom: spacing.xl,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  modalTitle: {
    color: c.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  modalClose: {
    color: c.textSecondary,
    fontSize: fontSize.xl,
    padding: spacing.xs,
  },
  costumeList: {
    paddingHorizontal: spacing.md,
  },
  costumeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  costumeItemLocked: {
    opacity: 0.4,
  },
  costumeEmoji: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  costumeName: {
    flex: 1,
    color: c.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  costumeNameLocked: {
    color: c.textSecondary,
  },
  costumeEquipped: {
    color: c.success,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  costumeLocked: {
    fontSize: 20,
  },
  emptyText: {
    color: c.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  });
}
