import React, { memo } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useThemeStore } from '@/stores/theme-store';

/**
 * iOS 26+: нативная «Назад» в react-native-screens 4.16 выключается при
 * нажатии и включается обратно, только если экран закрылся «как положено».
 * Нажал «Назад», пока экран ещё выезжает, — кнопка мертва на всех экранах до
 * перезапуска (проверено на iPhone 2026-11-07; свайп от края при этом работает).
 * Своя кнопка просто зовёт goBack(). Убрать, когда в новой сборке будет
 * react-native-screens ≥ 4.19.
 */
export const NEEDS_JS_BACK = Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 26;

const HeaderBack = memo(function HeaderBack({ onPress }: { onPress: () => void }) {
  // iOS 26 сам заливает кнопку шапки цветом headerTintColor (тёмная «пилюля»
  // в светлой теме) — надпись цвета фона, как у нативной «Назад».
  const color = useThemeStore((s) => s.theme.background);
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.btn} accessibilityRole="button" accessibilityLabel="Назад">
      <Feather name="chevron-left" size={22} color={color} />
      <Text style={[styles.label, { color }]}>Назад</Text>
    </Pressable>
  );
});

/** Опции шапки для экрана, открытого «вперёд»: на iOS 26+ — своя «Назад». */
export function jsBackOptions(navigation: { canGoBack: () => boolean; goBack: () => void }) {
  if (!NEEDS_JS_BACK) return {};
  const onPress = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };
  return {
    headerLeft: ({ canGoBack }: { canGoBack?: boolean }) => (canGoBack ? <HeaderBack onPress={onPress} /> : null),
  };
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', paddingRight: 6 },
  label: { fontSize: 17 },
});
