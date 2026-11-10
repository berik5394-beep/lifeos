import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '@/hooks/use-colors';
import { CONSENT_TEXT } from '@/constants/legal-text';

/**
 * Галочка согласия (App Store 2026-11-10): 16+, Условия и Политика, передача
 * данных стороннему ИИ (5.1.2(i) — явное разрешение до передачи). Ссылка ведёт
 * на полный текст — до входа тоже.
 */
export const ConsentCheck = memo(function ConsentCheck({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: () => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.row}
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={CONSENT_TEXT}
        hitSlop={6}
      >
        <View style={[styles.box, checked && styles.boxOn]}>
          {checked && <Feather name="check" size={14} color={c.background} />}
        </View>
        <Text style={styles.text}>{CONSENT_TEXT}</Text>
      </Pressable>
      <Pressable onPress={() => navigation.navigate('Legal' as never)} accessibilityRole="link" hitSlop={6}>
        <Text style={styles.link}>Читать Условия и Политику конфиденциальности</Text>
      </Pressable>
    </View>
  );
});

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    wrap: { gap: 8 },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    box: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: c.textSecondary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    boxOn: { backgroundColor: c.primary, borderColor: c.primary },
    text: { flex: 1, fontSize: 13, lineHeight: 18, color: c.textSecondary },
    link: { fontSize: 13, color: c.primary, fontWeight: '600', marginLeft: 32 },
  });
}
