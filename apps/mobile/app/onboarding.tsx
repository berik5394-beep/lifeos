import { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Dimensions,
  StyleSheet,
  TouchableOpacity,
  type ViewToken,
  type ListRenderItemInfo,
} from 'react-native';
import { useRouter } from 'expo-router';
import { createMMKV } from 'react-native-mmkv';
import { Button } from '@/components/ui';
import { colors, spacing, fontSize } from '@/constants';

const storage = createMMKV({ id: 'onboarding-storage' });
const { width } = Dimensions.get('window');

interface Slide {
  id: string;
  emoji: string;
  title: string;
  description: string;
}

interface GenderOption {
  key: 'female' | 'male';
  icon: string;
  label: string;
}

const GENDER_OPTIONS: GenderOption[] = [
  { key: 'female', icon: '\u{1F469}', label: 'Женский голос' },
  { key: 'male', icon: '\u{1F468}', label: 'Мужской голос' },
];

const slides: Slide[] = [
  {
    id: '1',
    emoji: '\u{1F680}',
    title: 'Добро пожаловать в LifeOS',
    description:
      'Управляйте задачами, привычками, финансами и здоровьем в одном приложении',
  },
  {
    id: '2',
    emoji: '\u{1F4CB}',
    title: 'Планируйте свой день',
    description:
      'Трекер задач, недельный планер и цели на год помогут вам быть продуктивным',
  },
  {
    id: '3',
    emoji: '\u{1F4AA}',
    title: 'Следите за здоровьем',
    description:
      'Шагомер, GPS-треки, дневник самочувствия и трекер привычек',
  },
  {
    id: '4',
    emoji: '\u{1F3A4}',
    title: 'Голосовой помощник',
    description:
      'Управляйте приложением голосом на русском языке',
  },
  {
    id: '5',
    emoji: '',
    title: 'Выберите голос ассистента',
    description: '',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const flatListRef = useRef<FlatList<Slide>>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedGender, setSelectedGender] = useState<'female' | 'male'>('female');

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
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    }
  }, [currentIndex]);

  const handleGenderSelect = useCallback((gender: 'female' | 'male') => {
    setSelectedGender(gender);
    storage.set('assistantGender', gender);
  }, []);

  const handleStart = useCallback(() => {
    storage.set('onboarding_complete', true);
    storage.set('assistantGender', selectedGender);
    router.replace('/(auth)/login');
  }, [router, selectedGender]);

  const isLastSlide = currentIndex === slides.length - 1;

  const renderSlide = useCallback(
    ({ item }: ListRenderItemInfo<Slide>) => {
      if (item.id === '5') {
        return (
          <View style={styles.slide}>
            <Text style={styles.title}>{item.title}</Text>
            <View style={styles.genderContainer}>
              {GENDER_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.genderCard,
                    selectedGender === option.key && styles.genderCardSelected,
                  ]}
                  onPress={() => handleGenderSelect(option.key)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.genderIcon}>{option.icon}</Text>
                  <Text style={styles.genderLabel}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );
      }
      return (
        <View style={styles.slide}>
          <Text style={styles.emoji}>{item.emoji}</Text>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.description}>{item.description}</Text>
        </View>
      );
    },
    [selectedGender, handleGenderSelect],
  );

  const keyExtractor = useCallback((item: Slide) => item.id, []);

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={slides}
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
          {slides.map((slide, index) => (
            <View
              key={slide.id}
              style={[
                styles.dot,
                index === currentIndex && styles.dotActive,
              ]}
            />
          ))}
        </View>

        <Button
          title={isLastSlide ? 'Начать' : 'Далее'}
          onPress={isLastSlide ? handleStart : handleNext}
          size="lg"
          style={styles.button}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  slide: {
    width,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emoji: {
    fontSize: 80,
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  description: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: spacing.md,
  },
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
    backgroundColor: colors.surfaceLight,
    marginHorizontal: spacing.xs,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 24,
  },
  button: {
    width: '100%',
  },
  genderContainer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  genderCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  genderCardSelected: {
    borderColor: colors.primary,
  },
  genderIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  genderLabel: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
});
