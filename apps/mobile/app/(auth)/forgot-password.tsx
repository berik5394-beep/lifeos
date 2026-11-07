import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Button, Input } from '@/components/ui';
import { useColors } from '@/hooks/use-colors';
import { requestResetCode, resetFormError, resetPasswordWithCode } from '@/services/password-reset';
import type { AuthStackParamList } from '@/navigation/types';

/**
 * «Забыли пароль?» как у всех: почта → код из письма (или из Telegram) →
 * новый пароль → обратно ко входу.
 */
export default function ForgotPasswordScreen() {
  const route = useRoute<RouteProp<AuthStackParamList, 'ForgotPassword'>>();
  const navigation = useNavigation();
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  const [email, setEmail] = useState(route.params?.email ?? '');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Введите почту, с которой регистрировались');
      return;
    }
    setError('');
    setBusy(true);
    try {
      setInfo(await requestResetCode(email));
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить код, попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const problem = resetFormError(code, password, repeat);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const msg = await resetPasswordWithCode(email, code, password);
      Alert.alert('Готово', msg, [{ text: 'Войти', onPress: () => navigation.goBack() }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сменить пароль, попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Сброс пароля</Text>
          <Text style={styles.subtitle}>
            {step === 'email' ? 'Пришлём код на почту — и в Telegram, если он подключён' : 'Введите код и новый пароль'}
          </Text>
        </View>

        <View style={styles.form}>
          <Input
            label="Email"
            placeholder="example@mail.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={step === 'email'}
          />

          {step === 'code' && (
            <>
              {info ? <Text style={styles.info}>{info}</Text> : null}
              <Input
                label="Код из письма"
                placeholder="6 цифр"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={7}
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
              />
              <Input
                label="Новый пароль"
                placeholder="Минимум 8 символов, буква и цифра"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                textContentType="newPassword"
              />
              <Input
                label="Повторите пароль"
                value={repeat}
                onChangeText={setRepeat}
                secureTextEntry
                autoCapitalize="none"
                textContentType="newPassword"
              />
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {step === 'email' ? (
            <Button title="Прислать код" onPress={sendCode} loading={busy} disabled={busy} size="lg" />
          ) : (
            <>
              <Button title="Сменить пароль" onPress={save} loading={busy} disabled={busy} size="lg" />
              <TouchableOpacity onPress={sendCode} disabled={busy} style={styles.again} accessibilityRole="button">
                <Text style={styles.link}>Прислать код ещё раз</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityRole="button">
          <Text style={styles.link}>Вернуться ко входу</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
    header: { alignItems: 'center', marginBottom: 32 },
    title: { fontSize: 32, fontWeight: '700', color: c.text, marginBottom: 8 },
    subtitle: { fontSize: 16, color: c.textSecondary, textAlign: 'center' },
    form: { gap: 16, marginBottom: 24 },
    info: { color: c.textSecondary, fontSize: 14, textAlign: 'center' },
    error: { color: c.danger, fontSize: 14, textAlign: 'center' },
    again: { alignItems: 'center', paddingVertical: 8 },
    back: { alignItems: 'center', paddingVertical: 12 },
    link: { color: c.primary, fontSize: 14, fontWeight: '600' },
  });
}
