import { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Dimensions,
  StyleSheet,
  TouchableOpacity,
  TextInput,
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

type PetOption = {
  key: 'cat' | 'dog' | 'fox' | 'owl' | 'dragon';
  icon: string;
  label: string;
};

const PET_OPTIONS: PetOption[] = [
  { key: 'cat', icon: '\u{1F431}', label: '\u041A\u043E\u0442\u0438\u043A' },
  { key: 'dog', icon: '\u{1F436}', label: '\u0421\u043E\u0431\u0430\u0447\u043A\u0430' },
  { key: 'fox', icon: '\u{1F98A}', label: '\u041B\u0438\u0441\u0451\u043D\u043E\u043A' },
  { key: 'owl', icon: '\u{1F989}', label: '\u0421\u043E\u0432\u0451\u043D\u043E\u043A' },
  { key: 'dragon', icon: '\u{1F409}', label: '\u0414\u0440\u0430\u043A\u043E\u043D\u0447\u0438\u043A' },
];

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
  {
    id: '6',
    emoji: '',
    title: '\u0412\u044B\u0431\u0435\u0440\u0438 \u043F\u0438\u0442\u043E\u043C\u0446\u0430',
    description: '\u0422\u0432\u043E\u0439 LifePet \u0431\u0443\u0434\u0435\u0442 \u0440\u0430\u0441\u0442\u0438 \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u0442\u043E\u0431\u043E\u0439',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const flatListRef = useRef<FlatList<Slide>>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedGender, setSelectedGender] = useState<'female' | 'male'>('female');
  const [selectedPet, setSelectedPet] = useState<PetOption['key']>('cat');
  const [petName, setPetName] = useState('LifePet');

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

  const handlePetSelect = useCallback((pet: PetOption['key']) => {
    setSelectedPet(pet);
    storage.set('petType', pet);
  }, []);

  const handleStart = useCallback(() => {
    storage.set('onboarding_complete', true);
    storage.set('assistantGender', selectedGender);
    storage.set('petType', selectedPet);
    storage.set('petName', petName.trim() || 'LifePet');
    router.replace('/(auth)/login');
  }, [router, selectedGender, selectedPet, petName]);

  const isLastSlide = currentIndex === slides.length - 1;

  const renderSlide = useCallback(
    ({ item }: ListRenderItemInfo<Slide>) => {
      if (item.id === '6') {
        return (
          <View style={styles.slide}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.description}>{item.description}</Text>
            <View style={styles.petContainer}>
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
              placeholderTextColor={colors.textSecondary}
              maxLength={20}
              returnKeyType="done"
            />
          </View>
        );
      }
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
    [selectedGender, handleGenderSelect, selectedPet, handlePetSelect, petName],
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
  petContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  petCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    width: 90,
  },
  petCardSelected: {
    borderColor: colors.primary,
  },
  petIcon: {
    fontSize: 36,
    marginBottom: spacing.xs,
  },
  petLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  petNameInput: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
    textAlign: 'center',
    width: '80%',
    borderWidth: 1,
    borderColor: colors.border,
  },
});
