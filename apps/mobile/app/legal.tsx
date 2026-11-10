import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { FadeInView } from '@/components/ui/fade-in-view';
import { LEGAL_UPDATED, PRIVACY_SECTIONS, SUPPORT_EMAIL, TERMS_SECTIONS, type LegalSection } from '@/constants/legal-text';

type Tab = 'privacy' | 'terms';

interface SectionProps {
  title: string;
  children: string;
  defaultOpen?: boolean;
  styles: ReturnType<typeof createStyles>;
  c: ReturnType<typeof useColors>;
}

function CollapsibleSection({ title, children, defaultOpen = false, styles, c }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setOpen(!open)}
        activeOpacity={0.7}
      >
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open && (
        <Text style={styles.sectionBody}>{children}</Text>
      )}
    </View>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    content: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xl * 2,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    backButton: {
      padding: spacing.sm,
      marginRight: spacing.sm,
    },
    backText: {
      fontSize: fontSize.xl,
      color: c.text,
    },
    headerTitle: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
    },
    tabRow: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      padding: 4,
      marginBottom: spacing.lg,
    },
    tab: {
      flex: 1,
      paddingVertical: spacing.sm + 2,
      alignItems: 'center',
      borderRadius: borderRadius.sm,
    },
    tabActive: {
      backgroundColor: c.primary,
    },
    tabText: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      fontWeight: '500',
    },
    tabTextActive: {
      color: '#FFFFFF',
      fontWeight: '600',
    },
    lastUpdated: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      textAlign: 'center',
      marginBottom: spacing.lg,
    },
    section: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.md,
    },
    sectionTitle: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
      flex: 1,
    },
    chevron: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      marginLeft: spacing.sm,
    },
    sectionBody: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      lineHeight: 22,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
    },
    contactCard: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginTop: spacing.md,
      alignItems: 'center',
    },
    contactTitle: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
      marginBottom: spacing.xs,
    },
    contactEmail: {
      fontSize: fontSize.sm,
      color: c.primary,
    },
  });
}

export default function LegalScreen() {
  const navigation = useNavigation();
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [activeTab, setActiveTab] = useState<Tab>('privacy');

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Text style={styles.backText}>{'←'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Правовая информация</Text>
        </View>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <FadeInView delay={0}>
          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'privacy' && styles.tabActive]}
              onPress={() => setActiveTab('privacy')}
            >
              <Text style={[styles.tabText, activeTab === 'privacy' && styles.tabTextActive]}>
                Конфиденциальность
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'terms' && styles.tabActive]}
              onPress={() => setActiveTab('terms')}
            >
              <Text style={[styles.tabText, activeTab === 'terms' && styles.tabTextActive]}>
                Условия использования
              </Text>
            </TouchableOpacity>
          </View>
        </FadeInView>

        {activeTab === 'privacy' ? (
          <SectionsContent sections={PRIVACY_SECTIONS} styles={styles} c={c} />
        ) : (
          <SectionsContent sections={TERMS_SECTIONS} styles={styles} c={c} />
        )}
      </ScrollView>
    </View>
  );
}

function SectionsContent({
  sections,
  styles,
  c,
}: {
  sections: LegalSection[];
  styles: ReturnType<typeof createStyles>;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <FadeInView delay={80}>
      <Text style={styles.lastUpdated}>Дата последнего обновления: {LEGAL_UPDATED}</Text>
      {sections.map((s, i) => (
        <CollapsibleSection key={s.title} title={s.title} defaultOpen={i === 0} styles={styles} c={c}>
          {s.body}
        </CollapsibleSection>
      ))}
      <View style={styles.contactCard}>
        <Text style={styles.contactTitle}>Связаться с нами</Text>
        <Text style={styles.contactEmail}>{SUPPORT_EMAIL}</Text>
      </View>
    </FadeInView>
  );
}
