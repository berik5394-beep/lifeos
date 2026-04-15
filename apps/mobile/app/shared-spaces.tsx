import React, { useMemo, useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useSharedSpaceStore } from '@/stores/shared-space-store';
import type { Theme } from '@/constants/themes';

export default function SharedSpacesScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation<any>();
  const { spaces, loading, fetchSpaces, createSpace } = useSharedSpaceStore();

  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchSpaces();
  }, [fetchSpaces]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    await createSpace(newName.trim());
    setCreating(false);
    setNewName('');
    setShowModal(false);
  }, [newName, createSpace]);

  const handlePress = useCallback(
    (spaceId: string, spaceName: string) => {
      navigation.navigate('SharedSpaceDetail', { spaceId, spaceName });
    },
    [navigation],
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Общие пространства</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading && spaces.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={spaces}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Feather name="users" size={48} color={c.textMuted} />
              <Text style={styles.emptyTitle}>Нет пространств</Text>
              <Text style={styles.emptySubtitle}>
                Создайте общее пространство для совместной работы
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => handlePress(item.id, item.name)}
              activeOpacity={0.7}
            >
              <View style={styles.cardIcon}>
                <Feather name="folder" size={24} color={c.primary} />
              </View>
              <View style={styles.cardContent}>
                <Text style={styles.cardName}>{item.name}</Text>
                <Text style={styles.cardMeta}>
                  {item.members?.length ?? 0} участников · {item.taskCount ?? 0} задач
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={c.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowModal(true)}
        activeOpacity={0.8}
      >
        <Feather name="plus" size={24} color="#FFF" />
      </TouchableOpacity>

      {/* Create Modal */}
      <Modal visible={showModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Новое пространство</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Название..."
              placeholderTextColor={c.textMuted}
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => { setShowModal(false); setNewName(''); }}
              >
                <Text style={styles.modalCancelText}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalCreate, !newName.trim() && styles.modalCreateDisabled]}
                onPress={handleCreate}
                disabled={!newName.trim() || creating}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.modalCreateText}>Создать</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    list: { padding: spacing.md, gap: spacing.sm },
    emptyContainer: { alignItems: 'center', paddingTop: 80, gap: spacing.sm },
    emptyTitle: { fontSize: fontSize.lg, fontWeight: '600', color: c.text },
    emptySubtitle: { fontSize: fontSize.sm, color: c.textMuted, textAlign: 'center' },
    card: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface,
      borderRadius: borderRadius.md, padding: spacing.md, gap: spacing.md,
    },
    cardIcon: {
      width: 48, height: 48, borderRadius: 12, backgroundColor: `${c.primary}15`,
      alignItems: 'center', justifyContent: 'center',
    },
    cardContent: { flex: 1 },
    cardName: { fontSize: fontSize.md, fontWeight: '600', color: c.text },
    cardMeta: { fontSize: fontSize.xs, color: c.textMuted, marginTop: 2 },
    fab: {
      position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28,
      backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
      shadowColor: c.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3,
      shadowRadius: 8, elevation: 6,
    },
    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
    },
    modalCard: {
      width: '85%', backgroundColor: c.surface, borderRadius: borderRadius.lg, padding: spacing.lg,
    },
    modalTitle: { fontSize: fontSize.lg, fontWeight: '700', color: c.text, marginBottom: spacing.md },
    modalInput: {
      backgroundColor: c.background, borderRadius: borderRadius.sm, padding: spacing.md,
      fontSize: fontSize.md, color: c.text, marginBottom: spacing.md,
    },
    modalButtons: { flexDirection: 'row', gap: spacing.sm },
    modalCancel: {
      flex: 1, padding: spacing.sm, borderRadius: borderRadius.sm,
      alignItems: 'center', backgroundColor: c.background,
    },
    modalCancelText: { fontSize: fontSize.sm, color: c.textSecondary },
    modalCreate: {
      flex: 1, padding: spacing.sm, borderRadius: borderRadius.sm,
      alignItems: 'center', backgroundColor: c.primary,
    },
    modalCreateDisabled: { opacity: 0.5 },
    modalCreateText: { fontSize: fontSize.sm, fontWeight: '600', color: '#FFF' },
  });
}
