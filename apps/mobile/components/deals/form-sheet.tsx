import React, { memo, useMemo, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { useColors } from '@/hooks/use-colors';
import { borderRadius, fontSize, spacing } from '@/constants';

/**
 * Модалка-форма панели «Сделки». Форма прижата к ВЕРХУ экрана: клавиатура снизу
 * её не перекроет даже там, где отступ шторки игнорируется (баг чата).
 * KeyboardAvoidingView — страховка для длинной формы на маленьком экране.
 */
export const FormSheet = memo(function FormSheet({
  visible,
  title,
  saveLabel,
  canSave,
  saving,
  onSave,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  saveLabel: string;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(c), [c]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть" />
        <View style={[styles.card, { marginTop: insets.top + spacing.lg }]}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
          <View style={styles.actions}>
            <Button title="Отмена" variant="outline" size="md" onPress={onClose} style={styles.action} />
            <Button title={saveLabel} size="md" onPress={onSave} disabled={!canSave || saving} loading={saving} style={styles.action} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    fill: { flex: 1 },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
    card: {
      marginHorizontal: spacing.md,
      padding: spacing.lg,
      borderRadius: borderRadius.xl,
      backgroundColor: c.background,
      maxHeight: '80%',
    },
    title: { color: c.text, fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.md },
    body: { gap: spacing.md },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    action: { flex: 1 },
  });
}
