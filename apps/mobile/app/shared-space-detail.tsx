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
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useSharedSpaceStore } from '@/stores/shared-space-store';
import { useTaskStore } from '@/stores/task-store';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/services/api';
import type { Theme } from '@/constants/themes';

interface SpaceTask {
  id: string;
  title: string;
  completed: boolean;
  category: string;
  priority: string;
}

export default function SharedSpaceDetailScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
  const route = useRoute<any>();
  const { spaceId, spaceName } = route.params as { spaceId: string; spaceName: string };

  const { spaces, addMember, removeMember } = useSharedSpaceStore();
  const token = useAuthStore((s) => s.token);

  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);

  const space = spaces.find((s) => s.id === spaceId);

  useEffect(() => {
    loadTasks();
  }, [spaceId]);

  const loadTasks = async () => {
    try {
      const data = await api.get<SpaceTask[]>(`/shared-spaces/${spaceId}/tasks`, token ?? undefined);
      setTasks(Array.isArray(data) ? data : []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = useCallback(async () => {
    if (!email.trim()) return;
    setAdding(true);
    await addMember(spaceId, email.trim());
    setEmail('');
    setAdding(false);
  }, [email, spaceId, addMember]);

  const handleRemoveMember = useCallback(
    (userId: string, name: string) => {
      Alert.alert('Удалить участника', `Удалить ${name} из пространства?`, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => removeMember(spaceId, userId) },
      ]);
    },
    [spaceId, removeMember],
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{spaceName}</Text>
        <View style={{ width: 32 }} />
      </View>

      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            {/* Members */}
            <Text style={styles.sectionTitle}>Участники</Text>
            <View style={styles.membersRow}>
              {space?.members?.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.memberChip}
                  onLongPress={() => handleRemoveMember(m.userId, m.user?.name || 'Участник')}
                >
                  <Feather name="user" size={14} color={c.primary} />
                  <Text style={styles.memberName}>{m.user?.name || m.userId}</Text>
                  {m.role === 'owner' && (
                    <Feather name="star" size={12} color="#F59E0B" />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Add member */}
            <View style={styles.addRow}>
              <TextInput
                style={styles.addInput}
                placeholder="Email участника..."
                placeholderTextColor={c.textMuted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[styles.addButton, !email.trim() && styles.addButtonDisabled]}
                onPress={handleAddMember}
                disabled={!email.trim() || adding}
              >
                {adding ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Feather name="user-plus" size={18} color="#FFF" />
                )}
              </TouchableOpacity>
            </View>

            {/* Tasks header */}
            <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>
              Задачи ({tasks.length})
            </Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator size="small" color={c.primary} style={{ marginTop: spacing.lg }} />
          ) : (
            <Text style={styles.emptyText}>Нет задач в этом пространстве</Text>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.taskCard}>
            <View style={[styles.taskDot, item.completed && styles.taskDotDone]} />
            <Text style={[styles.taskTitle, item.completed && styles.taskTitleDone]}>
              {item.title}
            </Text>
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
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: c.text, flex: 1, textAlign: 'center' },
    content: { padding: spacing.md },
    sectionTitle: { fontSize: fontSize.sm, fontWeight: '600', color: c.textSecondary, marginBottom: spacing.sm },
    membersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
    memberChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: c.surface, borderRadius: borderRadius.xl,
      paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    },
    memberName: { fontSize: fontSize.xs, color: c.text },
    addRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    addInput: {
      flex: 1, backgroundColor: c.surface, borderRadius: borderRadius.sm,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      fontSize: fontSize.sm, color: c.text,
    },
    addButton: {
      width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    addButtonDisabled: { opacity: 0.5 },
    taskCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surface, borderRadius: borderRadius.sm,
      padding: spacing.md, marginBottom: spacing.xs,
    },
    taskDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: c.textMuted },
    taskDotDone: { backgroundColor: c.success, borderColor: c.success },
    taskTitle: { flex: 1, fontSize: fontSize.sm, color: c.text },
    taskTitleDone: { textDecorationLine: 'line-through', color: c.textMuted },
    emptyText: { fontSize: fontSize.sm, color: c.textMuted, textAlign: 'center', marginTop: spacing.lg },
  });
}
