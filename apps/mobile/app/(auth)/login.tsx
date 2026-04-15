import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Input } from '@/components/ui';
import { useAuthStore } from '@/stores/auth-store';
import { useColors } from '@/hooks/use-colors';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const { login, isLoading } = useAuthStore();
  const navigation = useNavigation();
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Заполните все поля');
      return;
    }
    setError('');
    try {
      await login(email.trim(), password);
      // Navigation auto-switches via root navigator when token is set
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка входа';
      setError(message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>LifeOS</Text>
          <Text style={styles.subtitle}>Войдите в аккаунт</Text>
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
          />

          <Input
            label="Пароль"
            placeholder="Введите пароль"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            title="Войти"
            onPress={handleLogin}
            loading={isLoading}
            disabled={isLoading}
            size="lg"
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Нет аккаунта? </Text>
          <TouchableOpacity onPress={() => navigation.navigate('Register' as never)}>
            <Text style={styles.link}>Зарегистрироваться</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    scroll: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    header: {
      alignItems: 'center',
      marginBottom: 48,
    },
    title: {
      fontSize: 40,
      fontWeight: '700',
      color: c.text,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 18,
      color: c.textSecondary,
    },
    form: {
      gap: 16,
      marginBottom: 32,
    },
    error: {
      color: c.danger,
      fontSize: 14,
      textAlign: 'center',
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
    },
    footerText: {
      color: c.textSecondary,
      fontSize: 14,
    },
    link: {
      color: c.primary,
      fontSize: 14,
      fontWeight: '600',
    },
  });
}
