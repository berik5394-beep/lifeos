import { useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
  TextInput,
  Alert,
  type ViewToken,
  type ListRenderItemInfo,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { storage } from '@/services/storage';
import { useAppStore } from '@/stores/app-store';
import { useUIStore, type UIComplexity } from '@/stores/ui-store';
import { Button } from '@/components/ui';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';

const { width } = Dimensions.get('window');

/* ─── Types ─── */

interface Slide {
  id: string;
  type: 'welcome' | 'complexity' | 'pet' | 'assistant' | 'ready';
}

type PetKey = 'cat' | 'dog' | 'fox' | 'owl' | 'dragon';

interface PetOption {
  key: PetKey;
  icon: string;
  label: string;
}

type AssistantStyle = 'friendly' | 'strict' | 'calm' | 'toxic';

interface AssistantOption {
  key: AssistantStyle;
  icon: string;
  label: string;
  description: string;
}

interface ComplexityOption {
  key: UIComplexity;
  icon: string;
  label: string;
  description: string;
}

/* ─── Data ─── */

const SLIDES: Slide[] = [
  { id: '1', type: 'welcome' },
  { id: '2', type: 'complexity' },
  { id: '3', type: 'pet' },
  { id: '4', type: 'assistant' },
  { id: '5', type: 'ready' },
];

const PET_OPTIONS: PetOption[] = [
  { key: 'cat', icon: '\uD83D\uDC31', label: '\u041A\u043E\u0442\u0438\u043A' },
  { key: 'dog', icon: '\uD83D\uDC36', label: '\u0421\u043E\u0431\u0430\u0447\u043A\u0430' },
  { key: 'fox', icon: '\uD83E\uDD8A', label: '\u041B\u0438\u0441\u0451\u043D\u043E\u043A' },
  { key: 'owl', icon: '\uD83E\uDD89', label: '\u0421\u043E\u0432\u0451\u043D\u043E\u043A' },
  { key: 'dragon', icon: '\uD83D\uDC09', label: '\u0414\u0440\u0430\u043A\u043E\u043D\u0447\u0438\u043A' },
];

const COMPLEXITY_OPTIONS: ComplexityOption[] = [
  {
    key: 'simple',
    icon: '\uD83C\uDF31',
    label: '\u041F\u0440\u043E\u0441\u0442\u043E\u0439',
    description: '\u0417\u0430\u0434\u0430\u0447\u0438 \u0438 \u043F\u0440\u0438\u0432\u044B\u0447\u043A\u0438. \u0411\u0435\u0437 \u043B\u0438\u0448\u043D\u0435\u0433\u043E.',
  },
  {
    key: 'standard',
    icon: '\u26A1',
    label: '\u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442',
    description: '\u0424\u0438\u043D\u0430\u043D\u0441\u044B, \u0446\u0435\u043B\u0438, \u0442\u0435\u0433\u0438 \u0438 \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430.',
  },
  {
    key: 'power',
    icon: '\uD83D\uDE80',
    label: '\u041F\u0440\u043E\u0434\u0432\u0438\u043D\u0443\u0442\u044B\u0439',
    description: 'Kanban, Gantt, \u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E\u0441\u0442\u0438 \u0437\u0430\u0434\u0430\u0447, AI.',
  },
];

const ASSISTANT_OPTIONS: AssistantOption[] = [
  {
    key: 'friendly',
    icon: '\uD83D\uDE0A',
    label: '\u0414\u0440\u0443\u0436\u0435\u043B\u044E\u0431\u043D\u044B\u0439',
    description: '\u0428\u0443\u0442\u043A\u0438, \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0430, \u043C\u044F\u0433\u043A\u0438\u0435 \u043D\u0430\u043F\u043E\u043C\u0438\u043D\u0430\u043D\u0438\u044F',
  },
  {
    key: 'strict',
    icon: '\uD83D\uDCAA',
    label: '\u0421\u0442\u0440\u043E\u0433\u0438\u0439 \u0442\u0440\u0435\u043D\u0435\u0440',
    description: '\u0422\u0440\u0435\u0431\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439, \u0445\u0432\u0430\u043B\u0438\u0442 \u0437\u0430 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442',
  },
  {
    key: 'calm',
    icon: '\uD83E\uDDD8',
    label: '\u0421\u043F\u043E\u043A\u043E\u0439\u043D\u044B\u0439 \u043D\u0430\u0441\u0442\u0430\u0432\u043D\u0438\u043A',
    description: '\u041C\u0443\u0434\u0440\u044B\u0439, \u0431\u0435\u0437 \u0434\u0430\u0432\u043B\u0435\u043D\u0438\u044F',
  },
  {
    key: 'toxic',
    icon: '\uD83D\uDD25',
    label: '\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u044B\u0439 \u043C\u043E\u0442\u0438\u0432\u0430\u0442\u043E\u0440',
    description: '\u0421\u0430\u0440\u043A\u0430\u0437\u043C, \u0441\u0442\u044B\u0434, \u0433\u0440\u0443\u0431\u0430\u044F \u043C\u043E\u0442\u0438\u0432\u0430\u0446\u0438\u044F',
  },
];

const COMPLEXITY_LABELS: Record<UIComplexity, string> = {
  simple: '\u041F\u0440\u043E\u0441\u0442\u043E\u0439',
  standard: '\u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442',
  power: '\u041F\u0440\u043E\u0434\u0432\u0438\u043D\u0443\u0442\u044B\u0439',
};

const ASSISTANT_LABELS: Record<AssistantStyle, string> = {
  friendly: '\u0414\u0440\u0443\u0436\u0435\u043B\u044E\u0431\u043D\u044B\u0439',
  strict: '\u0421\u0442\u0440\u043E\u0433\u0438\u0439 \u0442\u0440\u0435\u043D\u0435\u0440',
  calm: '\u0421\u043F\u043E\u043A\u043E\u0439\u043D\u044B\u0439 \u043D\u0430\u0441\u0442\u0430\u0432\u043D\u0438\u043A',
  toxic: '\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u044B\u0439 \u043C\u043E\u0442\u0438\u0432\u0430\u0442\u043E\u0440',
};

const PET_LABELS: Record<PetKey, string> = {
  cat: '\u041A\u043E\u0442\u0438\u043A',
  dog: '\u0421\u043E\u0431\u0430\u0447\u043A\u0430',
  fox: '\u041B\u0438\u0441\u0451\u043D\u043E\u043A',
  owl: '\u0421\u043E\u0432\u0451\u043D\u043E\u043A',
  dragon: '\u0414\u0440\u0430\u043A\u043E\u043D\u0447\u0438\u043A',
};

const PET_ICONS: Record<PetKey, string> = {
  cat: '\uD83D\uDC31',
  dog: '\uD83D\uDC36',
  fox: '\uD83E\uDD8A',
  owl: '\uD83E\uDD89',
  dragon: '\uD83D\uDC09',
};

/* ─── Component ─── */

export default function OnboardingScreen() {
  const navigation = useNavigation();
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const flatListRef = useRef<FlatList<Slide>>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [selectedComplexity, setSelectedComplexity] = useState<UIComplexity>('standard');
  const [selectedPet, setSelectedPet] = useState<PetKey>('cat');
  const [petName, setPetName] = useState('LifePet');
  const [selectedAssistant, setSelectedAssistant] = useState<AssistantStyle>('friendly');

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
    [],
  );

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const handleNext = useCallback(() => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    }
  }, [currentIndex]);

  const handleSkip = useCallback(() => {
    flatListRef.current?.scrollToIndex({ index: SLIDES.length - 1 });
  }, []);

  const handleComplexitySelect = useCallback((complexity: UIComplexity) => {
    setSelectedComplexity(complexity);
  }, []);

  const handlePetSelect = useCallback((pet: PetKey) => {
    setSelectedPet(pet);
  }, []);

  const handleAssistantSelect = useCallback((style: AssistantStyle) => {
    if (style === 'toxic') {
      Alert.alert(
        '\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435',
        '\u042D\u0442\u043E\u0442 \u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442 \u0431\u0443\u0434\u0435\u0442 \u0433\u0440\u0443\u0431\u044B\u043C \u0438 \u0441\u0430\u0440\u043A\u0430\u0441\u0442\u0438\u0447\u043D\u044B\u043C. \u042D\u0442\u043E \u043C\u043E\u0442\u0438\u0432\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0439 \u0441\u0442\u0438\u043B\u044C \u2014 \u043D\u0435 \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u0439\u0442\u0435 \u0431\u043B\u0438\u0437\u043A\u043E \u043A \u0441\u0435\u0440\u0434\u0446\u0443.',
        [
          { text: '\u041E\u0442\u043C\u0435\u043D\u0430', style: 'cancel' },
          {
            text: '\u041F\u043E\u043D\u044F\u0442\u043D\u043E, \u0432\u044B\u0431\u0438\u0440\u0430\u044E!',
            onPress: () => setSelectedAssistant('toxic'),
          },
        ],
      );
    } else {
      setSelectedAssistant(style);
    }
  }, []);

  const handleStart = useCallback(() => {
    // Save all selections
    storage.setBoolean('onboarding_complete', true);
    storage.set('petType', selectedPet);
    storage.set('petName', petName.trim() || 'LifePet');
    storage.set('assistantStyle', selectedAssistant);

    // Save UI complexity to store
    useUIStore.getState().setComplexity(selectedComplexity);

    useAppStore.getState().setOnboardingDone(true);
  }, [selectedPet, petName, selectedAssistant, selectedComplexity]);

  const isLastSlide = currentIndex === SLIDES.length - 1;
  const isFirstSlide = currentIndex === 0;

  /* ─── Slide renderers ─── */

  const renderWelcome = useCallback(
    () => (
      <View style={styles.slide}>
        <Text style={styles.welcomeIcon}>{'\uD83C\uDF1F'}</Text>
        <Text style={styles.welcomeTitle}>
          {'\u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 LifeOS'}
        </Text>
        <Text style={styles.welcomeSubtitle}>
          {'\u0423\u043F\u0440\u0430\u0432\u043B\u044F\u0439 \u0436\u0438\u0437\u043D\u044C\u044E. \u0412\u0441\u0451 \u0432 \u043E\u0434\u043D\u043E\u043C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0438.'}
        </Text>
      </View>
    ),
    [styles],
  );

  const renderComplexity = useCallback(
    () => (
      <View style={styles.slide}>
        <Text style={styles.title}>
          {'\u0412\u044B\u0431\u0435\u0440\u0438 \u0441\u0432\u043E\u0439 \u0441\u0442\u0438\u043B\u044C'}
        </Text>
        <Text style={styles.subtitle}>
          {'\u041C\u043E\u0436\u043D\u043E \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043F\u043E\u0437\u0436\u0435 \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445'}
        </Text>
        <View style={styles.optionsList}>
          {COMPLEXITY_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.optionCard,
                selectedComplexity === option.key && styles.optionCardSelected,
              ]}
              onPress={() => handleComplexitySelect(option.key)}
              activeOpacity={0.7}
            >
              <Text style={styles.optionIcon}>{option.icon}</Text>
              <View style={styles.optionTextWrap}>
                <Text style={styles.optionLabel}>{option.label}</Text>
                <Text style={styles.optionDesc}>{option.description}</Text>
              </View>
              {selectedComplexity === option.key && (
                <View style={styles.checkCircle}>
                  <Text style={styles.checkMark}>{'\u2713'}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    ),
    [styles, selectedComplexity, handleComplexitySelect],
  );

  const renderPet = useCallback(
    () => (
      <View style={styles.slide}>
        <Text style={styles.title}>
          {'\u0412\u044B\u0431\u0435\u0440\u0438 \u0441\u0432\u043E\u0435\u0433\u043E \u043F\u0438\u0442\u043E\u043C\u0446\u0430'}
        </Text>
        <Text style={styles.subtitle}>
          {'\u041E\u043D \u0431\u0443\u0434\u0435\u0442 \u0440\u0430\u0441\u0442\u0438 \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u0442\u0432\u043E\u0438\u043C \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441\u043E\u043C'}
        </Text>
        <View style={styles.petGrid}>
          {PET_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.petCard,
                selectedPet === option.key && styles.petCardSelected,
              ]}
              onPress={() => handlePetSelect(option.key)}
              activeOpacity={0.7}
            >
              <Text style={styles.petIcon}>{option.icon}</Text>
              <Text style={styles.petLabel}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={styles.petNameInput}
          value={petName}
          onChangeText={setPetName}
          placeholder={'\u041A\u0430\u043A \u043D\u0430\u0437\u043E\u0432\u0451\u043C?'}
          placeholderTextColor={c.textSecondary}
          maxLength={20}
          returnKeyType="done"
        />
      </View>
    ),
    [styles, selectedPet, handlePetSelect, petName, c.textSecondary],
  );

  const renderAssistant = useCallback(
    () => (
      <View style={styles.slide}>
        <Text style={styles.title}>
          {'\u041A\u0430\u043A \u044F \u0434\u043E\u043B\u0436\u0435\u043D \u043E\u0431\u0449\u0430\u0442\u044C\u0441\u044F?'}
        </Text>
        <Text style={styles.subtitle}>
          {'\u0421\u0442\u0438\u043B\u044C AI-\u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442\u0430'}
        </Text>
        <View style={styles.optionsList}>
          {ASSISTANT_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.optionCard,
                selectedAssistant === option.key && styles.optionCardSelected,
              ]}
              onPress={() => handleAssistantSelect(option.key)}
              activeOpacity={0.7}
            >
              <Text style={styles.optionIcon}>{option.icon}</Text>
              <View style={styles.optionTextWrap}>
                <Text style={styles.optionLabel}>{option.label}</Text>
                <Text style={styles.optionDesc}>{option.description}</Text>
              </View>
              {selectedAssistant === option.key && (
                <View style={styles.checkCircle}>
                  <Text style={styles.checkMark}>{'\u2713'}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    ),
    [styles, selectedAssistant, handleAssistantSelect],
  );

  const renderReady = useCallback(
    () => (
      <View style={styles.slide}>
        <Text style={styles.welcomeIcon}>{'\uD83C\uDF89'}</Text>
        <Text style={styles.welcomeTitle}>
          {'\u0412\u0441\u0451 \u0433\u043E\u0442\u043E\u0432\u043E!'}
        </Text>
        <Text style={styles.welcomeSubtitle}>
          {'\u041D\u0430\u0447\u043D\u0451\u043C?'}
        </Text>

        <View style={styles.summaryContainer}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              {'\u0418\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441'}
            </Text>
            <Text style={styles.summaryValue}>
              {COMPLEXITY_LABELS[selectedComplexity]}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              {'\u041F\u0438\u0442\u043E\u043C\u0435\u0446'}
            </Text>
            <Text style={styles.summaryValue}>
              {PET_ICONS[selectedPet]} {petName.trim() || 'LifePet'}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              {'\u0410\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442'}
            </Text>
            <Text style={styles.summaryValue}>
              {ASSISTANT_LABELS[selectedAssistant]}
            </Text>
          </View>
        </View>
      </View>
    ),
    [styles, selectedComplexity, selectedPet, petName, selectedAssistant],
  );

  const renderSlide = useCallback(
    ({ item }: ListRenderItemInfo<Slide>) => {
      switch (item.type) {
        case 'welcome':
          return renderWelcome();
        case 'complexity':
          return renderComplexity();
        case 'pet':
          return renderPet();
        case 'assistant':
          return renderAssistant();
        case 'ready':
          return renderReady();
        default:
          return null;
      }
    },
    [renderWelcome, renderComplexity, renderPet, renderAssistant, renderReady],
  );

  const keyExtractor = useCallback((item: Slide) => item.id, []);

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={keyExtractor}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        bounces={false}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((slide, index) => (
            <View
              key={slide.id}
              style={[
                styles.dot,
                index === currentIndex && styles.dotActive,
              ]}
            />
          ))}
        </View>

        <View style={styles.footerButtons}>
          {!isLastSlide && !isFirstSlide && (
            <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
              <Text style={styles.skipText}>
                {'\u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C'}
              </Text>
            </TouchableOpacity>
          )}
          <Button
            title={isLastSlide ? '\u041D\u0430\u0447\u0430\u0442\u044C' : '\u0414\u0430\u043B\u0435\u0435'}
            onPress={isLastSlide ? handleStart : handleNext}
            size="lg"
            style={styles.button}
          />
        </View>
      </View>
    </View>
  );
}

/* ─── Styles ─── */

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    slide: {
      width,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },

    /* Welcome / Ready */
    welcomeIcon: {
      fontSize: 80,
      marginBottom: spacing.xl,
    },
    welcomeTitle: {
      fontSize: fontSize.xxl,
      fontWeight: '700',
      color: c.text,
      textAlign: 'center',
      marginBottom: spacing.md,
    },
    welcomeSubtitle: {
      fontSize: fontSize.lg,
      color: c.textSecondary,
      textAlign: 'center',
      lineHeight: 26,
      paddingHorizontal: spacing.md,
    },

    /* Section titles */
    title: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
      textAlign: 'center',
      marginBottom: spacing.xs,
    },
    subtitle: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      textAlign: 'center',
      marginBottom: spacing.lg,
    },

    /* Option cards (complexity / assistant) */
    optionsList: {
      width: '100%',
      gap: spacing.sm,
    },
    optionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderWidth: 2,
      borderColor: c.border,
    },
    optionCardSelected: {
      borderColor: c.primary,
      backgroundColor: c.surface,
    },
    optionIcon: {
      fontSize: 32,
      marginRight: spacing.md,
    },
    optionTextWrap: {
      flex: 1,
    },
    optionLabel: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
      marginBottom: 2,
    },
    optionDesc: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      lineHeight: 18,
    },
    checkCircle: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: spacing.sm,
    },
    checkMark: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },

    /* Pet grid */
    petGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
    },
    petCard: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: c.border,
      width: 90,
    },
    petCardSelected: {
      borderColor: c.primary,
    },
    petIcon: {
      fontSize: 36,
      marginBottom: spacing.xs,
    },
    petLabel: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: c.text,
      textAlign: 'center',
    },
    petNameInput: {
      marginTop: spacing.lg,
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '600',
      textAlign: 'center',
      width: '80%',
      borderWidth: 1,
      borderColor: c.border,
    },

    /* Summary (ready page) */
    summaryContainer: {
      marginTop: spacing.xl,
      width: '100%',
      backgroundColor: c.surface,
      borderRadius: borderRadius.lg,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
    },
    summaryLabel: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
    },
    summaryValue: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: c.text,
    },
    summaryDivider: {
      height: 1,
      backgroundColor: c.border,
    },

    /* Footer */
    footer: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xl + 16,
      alignItems: 'center',
    },
    dots: {
      flexDirection: 'row',
      marginBottom: spacing.lg,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.surfaceLight,
      marginHorizontal: spacing.xs,
    },
    dotActive: {
      backgroundColor: c.primary,
      width: 24,
    },
    footerButtons: {
      width: '100%',
      alignItems: 'center',
    },
    skipButton: {
      marginBottom: spacing.sm,
    },
    skipText: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
    },
    button: {
      width: '100%',
    },
  });
}
