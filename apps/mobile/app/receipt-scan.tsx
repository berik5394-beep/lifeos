import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { api, BRAIN_TIMEOUT_MS } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { useChatStore } from '@/stores/chat-store';
import type { PendingActionInfo } from '@/services/voice-followup';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';

/** Предел фото (сервер режет на 5 МБ; сжатая камера ~0.3–1 МБ). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

interface AnalyzeFinanceResponse {
  pending: PendingActionInfo | null;
  confirmationText: string | null;
  message?: string;
}

/**
 * Чек с фото → трата. Сервер читает сумму/магазин/категорию/дату, ставит
 * ожидающее подтверждение и пишет вопрос в чат; «Записать» здесь — тот же
 * путь, что «да» в чате (лимиты, цели, память, реакция робота). Без «да» —
 * ничего не пишется. Открывается из «Финансы → 📷 Чек» или фразой «сфоткай чек».
 */
export default function ReceiptScanScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const nav = useNavigation();
  const token = useAuthStore((s) => s.token);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState<{ text: string; messageId: string | null } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const analyze = useCallback(
    async (uri: string) => {
      if (!token) return;
      setImageUri(uri);
      setQuestion(null);
      setDone(null);
      try {
        const info = await FileSystem.getInfoAsync(uri);
        const size = (info as { size?: number }).size ?? 0;
        if (size > MAX_IMAGE_BYTES) {
          Alert.alert('Фото слишком большое', 'Сфоткай ещё раз — без зума и вспышки.');
          return;
        }
        setBusy(true);
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const mediaType = uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        // Загрузка + чтение фото моделью дольше обычного запроса.
        const res = await api.post<AnalyzeFinanceResponse>('/vision/analyze-finance', { image: base64, mediaType }, token, {
          timeoutMs: BRAIN_TIMEOUT_MS,
        });
        if (res.pending && res.confirmationText) {
          const id = useChatStore.getState().showPendingQuestion(res.confirmationText, res.pending);
          setQuestion({ text: res.confirmationText, messageId: id });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } else {
          setQuestion({ text: res.message ?? 'Не разобрал сумму на фото.', messageId: null });
        }
      } catch (err) {
        Alert.alert('Не получилось', err instanceof Error && err.message ? err.message : 'Не удалось прочитать чек');
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  const fromCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Нет доступа к камере', 'Разреши камеру в настройках телефона.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.4, exif: false });
    if (!r.canceled && r.assets[0]) await analyze(r.assets[0].uri);
  }, [analyze]);

  const fromLibrary = useCallback(async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5, exif: false });
    if (!r.canceled && r.assets[0]) await analyze(r.assets[0].uri);
  }, [analyze]);

  const answer = useCallback(
    async (yes: boolean) => {
      if (!question?.messageId) return;
      setBusy(true);
      try {
        await useChatStore.getState().confirmPendingAction(question.messageId, yes);
        // Сбой связи: стор вернул кнопки на вопрос — оставляем вопрос, можно повторить.
        const msgs = useChatStore.getState().messages;
        if (msgs.find((m) => m.id === question.messageId)?.pendingAction) {
          Alert.alert('Не получилось', 'Нет связи с сервером — попробуй ещё раз.');
          return;
        }
        const latest = msgs[0];
        setDone(latest?.role === 'assistant' ? latest.content : yes ? 'Записал.' : 'Окей, не записываю.');
        setQuestion(null);
      } finally {
        setBusy(false);
      }
    },
    [question],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Закрыть">
          <Feather name="x" size={24} color={c.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Чек → трата</Text>
        <View style={{ width: 24 }} />
      </View>

      {imageUri ? <Image source={{ uri: imageUri }} style={styles.photo} resizeMode="contain" /> : (
        <Text style={styles.hint}>Сфоткай чек или выбери скрин — прочитаю сумму, магазин и дату и спрошу, записать ли.</Text>
      )}

      {busy ? <ActivityIndicator color={c.primary} style={styles.spinner} /> : null}

      {question && !busy ? (
        <View style={styles.card}>
          <Text style={styles.cardText}>{question.text}</Text>
          {question.messageId ? (
            <View style={styles.row}>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => void answer(true)} accessibilityRole="button">
                <Text style={styles.btnPrimaryText}>Записать</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={() => void answer(false)} accessibilityRole="button">
                <Text style={styles.btnText}>Отмена</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}

      {done && !busy ? (
        <View style={styles.card}>
          <Text style={styles.cardText}>{done}</Text>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => nav.goBack()} accessibilityRole="button">
            <Text style={styles.btnPrimaryText}>Готово</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!question?.messageId && !busy ? (
        <View style={styles.row}>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => void fromCamera()} accessibilityRole="button">
            <Text style={styles.btnPrimaryText}>📷 Сфоткать</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => void fromLibrary()} accessibilityRole="button">
            <Text style={styles.btnText}>Из галереи</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background, paddingHorizontal: spacing.md },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
    title: { color: c.text, fontSize: fontSize.lg, fontWeight: '700' },
    hint: { color: c.textSecondary, fontSize: fontSize.md, textAlign: 'center', marginVertical: spacing.xl, lineHeight: 22 },
    photo: { width: '100%', height: 260, borderRadius: borderRadius.md, backgroundColor: c.surface, marginBottom: spacing.md },
    spinner: { marginVertical: spacing.lg },
    card: { backgroundColor: c.surface, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md, gap: spacing.md },
    cardText: { color: c.text, fontSize: fontSize.md, lineHeight: 22 },
    row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    btn: { flex: 1, paddingVertical: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', backgroundColor: c.surfaceLight },
    btnPrimary: { backgroundColor: c.primary },
    btnText: { color: c.text, fontSize: fontSize.md, fontWeight: '600' },
    btnPrimaryText: { color: '#FFFFFF', fontSize: fontSize.md, fontWeight: '700' },
  });
}
