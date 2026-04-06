import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { Card } from '@/components/ui';
import { Button } from '@/components/ui';
import { useJournalStore } from '@/stores/journal-store';
import { colors, spacing, borderRadius, fontSize } from '@/constants';

const MONTH_NAMES_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const SLEEP_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const MOOD_OPTIONS: { emoji: string; minValue: number; maxValue: number; value: number }[] = [
  { emoji: '😫', minValue: 1, maxValue: 2, value: 2 },
  { emoji: '😕', minValue: 3, maxValue: 4, value: 4 },
  { emoji: '😐', minValue: 5, maxValue: 6, value: 6 },
  { emoji: '🙂', minValue: 7, maxValue: 8, value: 8 },
  { emoji: '😄', minValue: 9, maxValue: 10, value: 10 },
];

function formatDate(date: Date): string {
  const day = date.getDate();
  const month = MONTH_NAMES_GENITIVE[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// --- Sub-components ---

interface DateSelectorProps {
  date: Date;
  onPrev: () => void;
  onNext: () => void;
}

const DateSelector = React.memo(function DateSelector({ date, onPrev, onNext }: DateSelectorProps) {
  return (
    <View style={styles.dateSelector}>
      <TouchableOpacity onPress={onPrev} style={styles.dateArrow}>
        <Text style={styles.dateArrowText}>{'‹'}</Text>
      </TouchableOpacity>
      <Text style={styles.dateText}>{formatDate(date)}</Text>
      <TouchableOpacity onPress={onNext} style={styles.dateArrow}>
        <Text style={styles.dateArrowText}>{'›'}</Text>
      </TouchableOpacity>
    </View>
  );
});

interface SleepCardProps {
  value: number | null;
  onChange: (hours: number) => void;
}

const SleepCard = React.memo(function SleepCard({ value, onChange }: SleepCardProps) {
  return (
    <Card style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionIcon}>😴</Text>
        <Text style={styles.sectionLabel}>Сон</Text>
        {value !== null && (
          <Text style={styles.sectionValue}>{value} ч</Text>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {SLEEP_OPTIONS.map((hours) => (
          <TouchableOpacity
            key={hours}
            style={[
              styles.chip,
              value === hours && styles.chipSelected,
            ]}
            onPress={() => onChange(hours)}
          >
            <Text
              style={[
                styles.chipText,
                value === hours && styles.chipTextSelected,
              ]}
            >
              {hours}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </Card>
  );
});

interface EnergyCardProps {
  value: number | null;
  onChange: (energy: number) => void;
}

const EnergyCard = React.memo(function EnergyCard({ value, onChange }: EnergyCardProps) {
  return (
    <Card style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionIcon}>⚡</Text>
        <Text style={styles.sectionLabel}>Энергия</Text>
        {value !== null && (
          <Text style={styles.sectionValue}>{value}/10</Text>
        )}
      </View>
      <View style={styles.energyRow}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((level) => {
          const isActive = value !== null && level <= value;
          return (
            <TouchableOpacity
              key={level}
              style={[
                styles.energyCircle,
                isActive && styles.energyCircleActive,
              ]}
              onPress={() => onChange(level)}
            >
              <Text
                style={[
                  styles.energyCircleText,
                  isActive && styles.energyCircleTextActive,
                ]}
              >
                {level}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Card>
  );
});

interface MoodCardProps {
  value: number | null;
  onChange: (mood: number) => void;
}

const MoodCard = React.memo(function MoodCard({ value, onChange }: MoodCardProps) {
  return (
    <Card style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionIcon}>😊</Text>
        <Text style={styles.sectionLabel}>Настроение</Text>
      </View>
      <View style={styles.moodRow}>
        {MOOD_OPTIONS.map((option) => {
          const isSelected = value !== null && value >= option.minValue && value <= option.maxValue;
          return (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.moodButton,
                isSelected && styles.moodButtonSelected,
              ]}
              onPress={() => onChange(option.value)}
            >
              <Text style={styles.moodEmoji}>{option.emoji}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Card>
  );
});

interface NotesCardProps {
  value: string;
  onChange: (text: string) => void;
}

const NotesCard = React.memo(function NotesCard({ value, onChange }: NotesCardProps) {
  return (
    <Card style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionIcon}>📝</Text>
        <Text style={styles.sectionLabel}>Заметки</Text>
      </View>
      <TextInput
        style={styles.notesInput}
        multiline
        numberOfLines={4}
        placeholder="Заметки на сегодня..."
        placeholderTextColor={colors.textSecondary}
        value={value}
        onChangeText={onChange}
        textAlignVertical="top"
      />
    </Card>
  );
});

// --- Main Screen ---

export default function JournalScreen() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [sleepHours, setSleepHours] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  const { fetchEntry, saveEntry, isLoading } = useJournalStore();

  const dateString = toDateString(selectedDate);

  useEffect(() => {
    let cancelled = false;

    const loadEntry = async () => {
      await fetchEntry(dateString);
      if (cancelled) return;

      const state = useJournalStore.getState();
      const entry = state.entries.find((e) => e.date === dateString) ?? state.todayEntry;

      if (entry && entry.date === dateString) {
        setSleepHours(entry.sleepHours);
        setEnergy(entry.energy);
        setMood(entry.mood);
        setNotes(entry.notes ?? '');
      } else {
        setSleepHours(null);
        setEnergy(null);
        setMood(null);
        setNotes('');
      }
    };

    loadEntry();
    return () => {
      cancelled = true;
    };
  }, [dateString, fetchEntry]);

  const handlePrevDay = useCallback(() => {
    setSelectedDate((prev) => addDays(prev, -1));
  }, []);

  const handleNextDay = useCallback(() => {
    setSelectedDate((prev) => addDays(prev, 1));
  }, []);

  const handleSave = useCallback(async () => {
    try {
      await saveEntry({
        date: dateString,
        sleepHours,
        energy,
        mood,
        notes: notes.trim() || null,
      });
      Alert.alert('Готово', 'Запись сохранена');
    } catch {
      Alert.alert('Ошибка', 'Не удалось сохранить запись');
    }
  }, [dateString, sleepHours, energy, mood, notes, saveEntry]);

  return (
    <>
      <Stack.Screen options={{ title: 'Дневник', headerShown: true }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <DateSelector
          date={selectedDate}
          onPrev={handlePrevDay}
          onNext={handleNextDay}
        />

        <SleepCard value={sleepHours} onChange={setSleepHours} />
        <EnergyCard value={energy} onChange={setEnergy} />
        <MoodCard value={mood} onChange={setMood} />
        <NotesCard value={notes} onChange={setNotes} />

        <Button
          title="Сохранить"
          onPress={handleSave}
          loading={isLoading}
          disabled={isLoading}
          style={styles.saveButton}
        />
      </ScrollView>
    </>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
  },

  // Date selector
  dateSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  dateArrow: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateArrowText: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '600',
  },
  dateText: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },

  // Section cards
  sectionCard: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionIcon: {
    fontSize: fontSize.xl,
  },
  sectionLabel: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
    flex: 1,
  },
  sectionValue: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },

  // Sleep chips
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chip: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: colors.primary,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: colors.text,
  },

  // Energy circles
  energyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  energyCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  energyCircleActive: {
    backgroundColor: colors.success,
  },
  energyCircleText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  energyCircleTextActive: {
    color: colors.text,
  },

  // Mood
  moodRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  moodButton: {
    width: 52,
    height: 52,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodButtonSelected: {
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.secondary,
  },
  moodEmoji: {
    fontSize: 28,
  },

  // Notes
  notesInput: {
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: fontSize.md,
    minHeight: 100,
  },

  // Save
  saveButton: {
    marginTop: spacing.sm,
  },
});
