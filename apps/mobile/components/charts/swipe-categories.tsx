import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ListRenderItemInfo,
} from 'react-native';
import { ProgressRing } from '@/components/ui/progress-ring';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';

interface CategoryItem {
  key: string;
  label: string;
  icon: string;
  color: string;
  progress: number;
}

interface SwipeCategoriesProps {
  categories: CategoryItem[];
  onSelect: (key: string) => void;
  selectedKey?: string;
}

const CARD_WIDTH = 120;
const CARD_HEIGHT = 100;

const CategoryCard = React.memo(function CategoryCard({
  item,
  isSelected,
  onPress,
}: {
  item: CategoryItem;
  isSelected: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <TouchableOpacity
      style={[
        styles.card,
        isSelected && styles.cardSelected,
        { borderColor: isSelected ? c.primary : 'transparent' },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.icon}>{item.icon}</Text>
      <Text style={styles.label} numberOfLines={1}>
        {item.label}
      </Text>
      <ProgressRing
        progress={item.progress}
        size={30}
        strokeWidth={3}
        color={item.color}
      />
    </TouchableOpacity>
  );
});

export const SwipeCategories = React.memo(function SwipeCategories({
  categories,
  onSelect,
  selectedKey,
}: SwipeCategoriesProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<CategoryItem>) => (
      <CategoryCard
        item={item}
        isSelected={item.key === selectedKey}
        onPress={() => onSelect(item.key)}
      />
    ),
    [selectedKey, onSelect],
  );

  const keyExtractor = useCallback((item: CategoryItem) => item.key, []);

  return (
    <FlatList
      data={categories}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.listContent}
      snapToInterval={CARD_WIDTH + spacing.sm}
      decelerationRate="fast"
    />
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    listContent: {
      paddingHorizontal: spacing.sm,
      gap: spacing.sm,
    },
    card: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      gap: spacing.xs,
    },
    cardSelected: {
      backgroundColor: c.surfaceLight,
    },
    icon: {
      fontSize: 24,
    },
    label: {
      color: c.text,
      fontSize: fontSize.xs,
      fontWeight: '600',
    },
  });
}
