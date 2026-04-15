import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { CharacterRenderer } from '@/components/characters/CharacterRenderer';
import { CHARACTERS, RARITY_NAMES, getItemsForCharacter } from '@/constants/characters';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';
import { useAuthStore } from '@/stores/auth-store';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 48;

export default function CharacterSelectScreen() {
  const navigation = useNavigation();
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const { token } = useAuthStore();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSelecting, setIsSelecting] = useState(false);

  const selectedChar = CHARACTERS[selectedIndex];
  const charItems = getItemsForCharacter(selectedChar.key);

  const handleSelect = useCallback(async () => {
    if (!token) return;
    setIsSelecting(true);
    try {
      const API = process.env.EXPO_PUBLIC_API_URL || 'http://172.20.10.4:3000';
      const res = await fetch(`${API}/pet/character`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ characterType: selectedChar.key }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `HTTP ${res.status}`);
      }
      Alert.alert('Персонаж выбран!', `${selectedChar.name} теперь твой герой!`);
      navigation.goBack();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Не удалось выбрать персонажа';
      Alert.alert('Ошибка', message);
    } finally {
      setIsSelecting(false);
    }
  }, [token, selectedChar, navigation]);

  const renderItemSlot = (slot: string, label: string) => {
    const slotItems = charItems.filter(i => i.slot === slot);
    if (slotItems.length === 0) return null;
    return (
      <View style={styles.slotSection} key={slot}>
        <Text style={styles.slotLabel}>{label}</Text>
        {slotItems.map(item => (
          <View key={item.key} style={[styles.itemRow, { borderLeftColor: item.rarityColor }]}>
            <Text style={styles.itemEmoji}>{item.emoji}</Text>
            <View style={styles.itemInfo}>
              <View style={styles.itemNameRow}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={[styles.itemRarity, { color: item.rarityColor }]}>
                  {RARITY_NAMES[item.rarity]}
                </Text>
              </View>
              <Text style={styles.itemDesc}>{item.description}</Text>
              <Text style={styles.itemUnlock}>{item.unlockCondition}</Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.backText}>{'\u2190'} Назад</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Выбор Персонажа</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Character selector tabs */}
        <View style={styles.tabsRow}>
          {CHARACTERS.map((char, idx) => (
            <TouchableOpacity
              key={char.key}
              style={[styles.tab, selectedIndex === idx && styles.tabActive]}
              onPress={() => setSelectedIndex(idx)}
              activeOpacity={0.7}
            >
              <Text style={styles.tabEmoji}>{char.emoji}</Text>
              <Text style={[styles.tabName, selectedIndex === idx && styles.tabNameActive]}>
                {char.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Character preview card */}
        <View style={[styles.previewCard, { borderColor: selectedChar.glowColor + '60' }]}>
          <View style={styles.characterPreview}>
            <CharacterRenderer
              character={selectedChar}
              size={180}
              level={1}
              showGlow={true}
            />
          </View>

          <Text style={[styles.charName, { color: selectedChar.glowColor }]}>
            {selectedChar.name}
          </Text>
          <Text style={styles.charTitle}>{selectedChar.title}</Text>
          <Text style={styles.charDesc}>{selectedChar.description}</Text>
          <View style={styles.growsRow}>
            <Text style={styles.growsLabel}>Растёт от:</Text>
            <Text style={styles.growsValue}>{selectedChar.growsFrom}</Text>
          </View>

          <TouchableOpacity
            style={[styles.selectButton, { backgroundColor: selectedChar.glowColor }, isSelecting && styles.selectButtonDisabled]}
            onPress={handleSelect}
            disabled={isSelecting}
            activeOpacity={0.8}
          >
            <Text style={styles.selectButtonText}>
              {isSelecting ? 'Выбираю...' : `Выбрать ${selectedChar.name}`}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Items section */}
        <Text style={styles.sectionTitle}>Доступные предметы</Text>
        <Text style={styles.sectionSubtitle}>
          Предметы разблокируются по мере достижений
        </Text>

        {renderItemSlot('helmet', '🪖 Шлемы')}
        {renderItemSlot('armor', '🦺 Броня')}
        {renderItemSlot('weapon', '🗡️ Оружие')}
        {renderItemSlot('shield', '🛡️ Щиты')}
        {renderItemSlot('boots', '👟 Ботинки')}
        {renderItemSlot('aura', '💫 Ауры')}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  backText: {
    color: c.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  title: {
    color: c.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  // Tabs
  tabsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    gap: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActive: {
    borderColor: c.primary,
    backgroundColor: c.surfaceLight,
  },
  tabEmoji: {
    fontSize: 22,
    marginBottom: 2,
  },
  tabName: {
    color: c.textSecondary,
    fontSize: 10,
    fontWeight: '600',
  },
  tabNameActive: {
    color: c.text,
  },
  // Preview card
  previewCard: {
    backgroundColor: c.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  characterPreview: {
    height: 260,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  charName: {
    fontSize: fontSize.xl + 4,
    fontWeight: '900',
    marginBottom: spacing.xs,
  },
  charTitle: {
    color: c.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  charDesc: {
    color: c.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  growsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.lg,
    backgroundColor: c.surfaceLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  growsLabel: {
    color: c.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  growsValue: {
    color: c.text,
    fontSize: fontSize.sm,
    flex: 1,
  },
  selectButton: {
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  selectButtonDisabled: {
    opacity: 0.6,
  },
  selectButtonText: {
    color: '#fff',
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  // Items section
  sectionTitle: {
    color: c.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  sectionSubtitle: {
    color: c.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
  },
  slotSection: {
    marginBottom: spacing.md,
  },
  slotLabel: {
    color: c.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    borderLeftWidth: 3,
    alignItems: 'center',
  },
  itemEmoji: {
    fontSize: 24,
    marginRight: spacing.sm,
  },
  itemInfo: {
    flex: 1,
  },
  itemNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  itemName: {
    color: c.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  itemRarity: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  itemDesc: {
    color: c.textSecondary,
    fontSize: fontSize.xs,
    marginBottom: 2,
  },
  itemUnlock: {
    color: c.primary,
    fontSize: fontSize.xs - 1,
    fontStyle: 'italic',
  },
  });
}
