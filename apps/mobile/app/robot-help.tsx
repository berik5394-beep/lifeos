import React, { memo, useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { HELP_SECTIONS, type HelpSection } from '@/services/robot-help';
import { useChatStore } from '@/stores/chat-store';
import { useRoomIntroStore } from '@/stores/room-intro-store';
import { openConversation } from '@/services/open-conversation';

type Colors = ReturnType<typeof useColors>;

/**
 * «Как пользоваться» — кнопка «?» в комнате (Berik 2026-11-09). Что умеет
 * робот и как с ним говорить; пример — тап: фраза встаёт в строку ввода на
 * главном экране (поправить и ➤), «Давай поговорим» — сразу живой разговор.
 */
export default function RobotHelpScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();

  const pickExample = useCallback(
    (text: string) => {
      if (text === 'Давай поговорим') {
        navigation.goBack();
        openConversation();
        return;
      }
      useChatStore.getState().setPrefill({ text, for: 'Home' });
      navigation.goBack();
    },
    [navigation],
  );

  const showIntro = useCallback(() => {
    useRoomIntroStore.getState().ask();
    navigation.goBack();
  }, [navigation]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.lead}>
        Робот — это и есть приложение: всё, что ты видишь на экранах, можно сделать одной фразой. Нажми пример — он
        встанет в строку, поправь и отправь.
      </Text>
      {HELP_SECTIONS.map((s) => (
        <Section key={s.title} section={s} styles={styles} onExample={pickExample} />
      ))}
      <Pressable style={styles.introBtn} onPress={showIntro} accessibilityRole="button">
        <Text style={styles.introText}>Показать подсказки в комнате ещё раз</Text>
      </Pressable>
    </ScrollView>
  );
}

const Section = memo(function Section({
  section,
  styles,
  onExample,
}: {
  section: HelpSection;
  styles: ReturnType<typeof createStyles>;
  onExample: (t: string) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {section.icon} {section.title}
      </Text>
      {section.lines.map((l) => (
        <Text key={l} style={styles.line}>
          • {l}
        </Text>
      ))}
      {section.examples?.length ? (
        <View style={styles.chips}>
          {section.examples.map((e) => (
            <Pressable
              key={e}
              style={styles.chip}
              onPress={() => onExample(e)}
              accessibilityRole="button"
              accessibilityLabel={`Пример: ${e}`}
            >
              <Text style={styles.chipText}>«{e}»</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
});

function createStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.md },
    lead: { color: c.textSecondary, fontSize: fontSize.md, lineHeight: 22 },
    card: { backgroundColor: c.surface, borderRadius: borderRadius.lg, padding: spacing.md, gap: 6 },
    title: { color: c.text, fontSize: fontSize.lg, fontWeight: '700', marginBottom: 2 },
    line: { color: c.text, fontSize: fontSize.sm, lineHeight: 20 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
    chip: {
      borderRadius: borderRadius.xl,
      borderWidth: 1,
      borderColor: c.primary,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 6,
    },
    chipText: { color: c.primary, fontSize: fontSize.sm, fontWeight: '600' },
    introBtn: { alignSelf: 'center', paddingVertical: spacing.sm },
    introText: { color: c.textSecondary, fontSize: fontSize.sm, textDecorationLine: 'underline' },
  });
}
