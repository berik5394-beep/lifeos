import React, { useMemo, useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useTagStore } from '@/stores/tag-store';
import { TagChip } from '@/components/ui/tag-chip';
import type { Theme } from '@/constants/themes';

const PRESET_COLORS = [
  '#EF4444', '#F59E0B', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899',
  '#06B6D4', '#F97316', '#6366F1', '#14B8A6', '#A855F7', '#6B7280',
];

export default function TagManagerScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
  const { tags, loading, fetchTags, createTag, deleteTag } = useTagStore();

  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[4]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    await createTag(name.trim(), selectedColor);
    setName('');
  }, [name, selectedColor, createTag]);

  const handleDelete = useCallback(
    (id: string, tagName: string) => {
      Alert.alert('Удалить тег', `Удалить тег "${tagName}"?`, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => deleteTag(id) },
      ]);
    },
    [deleteTag],
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Теги</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Add tag section */}
      <View style={styles.addSection}>
        <Text style={styles.sectionLabel}>Новый тег</Text>
        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            placeholder="Название тега..."
            placeholderTextColor={c.textMuted}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />
          <TouchableOpacity
            style={[styles.addButton, !name.trim() && styles.addButtonDisabled]}
            onPress={handleCreate}
            disabled={!name.trim()}
          >
            <Feather name="plus" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* Color picker */}
        <View style={styles.colorRow}>
          {PRESET_COLORS.map((color) => (
            <TouchableOpacity
              key={color}
              style={[
                styles.colorDot,
                { backgroundColor: color },
                selectedColor === color && styles.colorDotSelected,
              ]}
              onPress={() => setSelectedColor(color)}
            />
          ))}
        </View>

        {/* Preview */}
        {name.trim() ? (
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>Превью:</Text>
            <TagChip name={name.trim()} color={selectedColor} />
          </View>
        ) : null}
      </View>

      {/* Tags list */}
      <Text style={styles.listLabel}>Ваши теги ({tags.length})</Text>
      <FlatList
        data={tags}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.tagsList}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {loading ? 'Загрузка...' : 'Нет тегов. Создайте первый!'}
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.tagRow}>
            <TagChip name={item.name} color={item.color} size="medium" />
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => handleDelete(item.id, item.name)}
            >
              <Feather name="trash-2" size={16} color={c.danger} />
            </TouchableOpacity>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function createStyles(c: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
    },
    backButton: { padding: spacing.xs },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: c.text },
    addSection: {
      padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
    },
    sectionLabel: { fontSize: fontSize.sm, fontWeight: '600', color: c.textSecondary, marginBottom: spacing.sm },
    addRow: { flexDirection: 'row', gap: spacing.sm },
    addInput: {
      flex: 1, backgroundColor: c.surface, borderRadius: borderRadius.sm,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      fontSize: fontSize.md, color: c.text,
    },
    addButton: {
      width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    addButtonDisabled: { opacity: 0.5 },
    colorRow: {
      flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md,
    },
    colorDot: {
      width: 28, height: 28, borderRadius: 14,
    },
    colorDotSelected: {
      borderWidth: 3, borderColor: c.text,
    },
    previewRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md,
    },
    previewLabel: { fontSize: fontSize.xs, color: c.textMuted },
    listLabel: {
      fontSize: fontSize.sm, fontWeight: '600', color: c.textSecondary,
      paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm,
    },
    tagsList: { paddingHorizontal: spacing.md },
    tagRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
    },
    deleteButton: { padding: spacing.sm },
    emptyText: { fontSize: fontSize.sm, color: c.textMuted, textAlign: 'center', paddingTop: spacing.lg },
  });
}
