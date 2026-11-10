import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { ConsentCheck } from '@/components/shared/consent-check';
import { useAuthStore } from '@/stores/auth-store';
import { useColors } from '@/hooks/use-colors';
import { AI_PROVIDERS } from '@/constants/legal-text';

/**
 * Согласие для тех, кто уже в приложении (App Store 2026-11-10): аккаунт создан
 * до галочки на регистрации или политика обновилась. Один раз — «Принимаю».
 */
export default function ConsentScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const acceptConsent = useAuthStore((s) => s.acceptConsent);
  const logout = useAuthStore((s) => s.logout);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onAccept = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await acceptConsent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не получилось сохранить. Проверь интернет.');
    } finally {
      setBusy(false);
    }
  }, [acceptConsent]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Пара слов о твоих данных</Text>
        <Text style={styles.body}>
          Робот понимает тебя с помощью сторонних сервисов искусственного интеллекта ({AI_PROVIDERS.join(', ')}). Им
          уходят твои сообщения, голос, фото и данные приложения — только чтобы ответить и помочь. Рекламе и
          посторонним мы ничего не передаём и не продаём.
        </Text>
        <Text style={styles.body}>Удалить аккаунт и все данные можно в любой момент: «Настройки → Удалить аккаунт».</Text>
        <ConsentCheck checked={agreed} onToggle={() => setAgreed((v) => !v)} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Принимаю" onPress={onAccept} loading={busy} disabled={!agreed || busy} size="lg" />
        <View style={styles.footer}>
          <TouchableOpacity onPress={() => void logout()} accessibilityRole="button">
            <Text style={styles.logout}>Не согласен — выйти</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32, gap: 18 },
    title: { fontSize: 26, fontWeight: '700', color: c.text },
    body: { fontSize: 15, lineHeight: 22, color: c.text },
    error: { color: c.danger, fontSize: 14, textAlign: 'center' },
    footer: { alignItems: 'center', marginTop: 4 },
    logout: { color: c.textSecondary, fontSize: 14 },
  });
}
