import React, { useCallback, useEffect, useState , useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
// expo-file-system 19.x: используем legacy API чтобы получить getInfoAsync / readAsStringAsync.
// Новый class-based API (Paths/File) не нужен здесь — операции одноразовые.
import * as FileSystem from 'expo-file-system/legacy';
import { useNavigation } from '@react-navigation/native';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';

// Безопасный лимит для тела запроса. Сервер: bodyLimit 15 MB.
// base64 раздувает на 33%, поэтому исходный JPEG должен быть ≤ ~10 MB.
// Но Claude Vision не нуждается в гигантских картинках — 1.5 MB более чем достаточно.
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

type FoodAnalysis = {
  foodName: string;
  portion: string;
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  confidence: 'high' | 'medium' | 'low' | number;
  notes?: string;
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'высокая',
  medium: 'средняя',
  low: 'низкая',
};

type TodayItem = {
  id: string;
  foodName: string;
  portion?: string | null;
  calories: number;
  carbs: number;
  createdAt: string;
};

type TodayTotals = {
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  items: TodayItem[];
};

type TodayApiResponse = {
  entries?: TodayItem[];
  totals?: { calories?: number; carbs?: number; protein?: number; fat?: number };
};

export default function NutritionScreen(): React.ReactElement {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation<any>();
  const token = useAuthStore((s) => s.token);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analysis, setAnalysis] = useState<FoodAnalysis | null>(null);
  const [today, setToday] = useState<TodayTotals | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadToday = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.get<TodayApiResponse>('/vision/food/today', token);
      const items = Array.isArray(data?.entries) ? data.entries : [];
      const totals = data?.totals ?? {};
      setToday({
        calories: totals.calories ?? 0,
        carbs: totals.carbs ?? 0,
        protein: totals.protein ?? 0,
        fat: totals.fat ?? 0,
        items,
      });
    } catch (err) {
      console.warn('Failed to load today nutrition', err);
      setToday({ calories: 0, carbs: 0, protein: 0, fat: 0, items: [] });
    }
  }, [token]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadToday();
    setRefreshing(false);
  }, [loadToday]);

  // Универсальная обработка результата ImagePicker:
  // 1) Берём URI выбранного фото
  // 2) Узнаём размер файла (FileSystem.getInfoAsync)
  // 3) Если файл слишком тяжёлый — показываем понятную ошибку
  //    (с камеры iPhone это может случиться при quality > 0.2 на 12 MP)
  // 4) Читаем base64 через FileSystem.readAsStringAsync — это надёжнее,
  //    чем asset.base64 от ImagePicker (особенно для HEIC → JPEG конверсии)
  const handlePickedAsset = useCallback(
    async (uri: string) => {
      setImageUri(uri);
      setAnalysis(null);
      try {
        const info = await FileSystem.getInfoAsync(uri);
        const sizeBytes = (info as any).size ?? 0;
        console.debug(`[nutrition] picked image: ${uri}, size=${sizeBytes} bytes`);

        if (sizeBytes > MAX_IMAGE_BYTES) {
          Alert.alert(
            'Фото слишком большое',
            `Размер ${(sizeBytes / 1024 / 1024).toFixed(1)} MB превышает лимит ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(1)} MB. Сделай фото с меньшего расстояния или загрузи из галереи уже сжатое.`,
          );
          return;
        }

        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await analyzeFood(base64);
      } catch (err) {
        console.warn('[nutrition] handlePickedAsset error', err);
        const msg = err instanceof Error ? err.message : 'Не удалось обработать фото';
        Alert.alert('Ошибка', msg);
      }
    },
    [],
  );

  const pickFromCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Нет доступа', 'Разреши доступ к камере в настройках iOS.');
      return;
    }
    // quality 0.2 даёт ~300-700 KB на iPhone 12 MP — с большим запасом по лимиту
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.2,
      base64: false,
      allowsEditing: false,
      exif: false,
    });
    if (!result.canceled && result.assets[0]) {
      await handlePickedAsset(result.assets[0].uri);
    }
  }, [handlePickedAsset]);

  const pickFromLibrary = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.3,
      base64: false,
      allowsEditing: false,
      exif: false,
    });
    if (!result.canceled && result.assets[0]) {
      await handlePickedAsset(result.assets[0].uri);
    }
  }, [handlePickedAsset]);

  const analyzeFood = useCallback(
    async (base64: string) => {
      if (!token) return;
      setAnalyzing(true);
      try {
        console.debug(`[nutrition] sending base64 length=${base64.length} (~${Math.round(base64.length / 1024)} KB)`);
        // Сервер ждёт { image, mediaType }, а не { imageBase64 }
        const data = await api.post<FoodAnalysis>(
          '/vision/analyze-food',
          { image: base64, mediaType: 'image/jpeg' },
          token,
        );
        setAnalysis(data);
      } catch (err) {
        console.warn('[nutrition] analyzeFood error', err);
        const status = (err as any)?.status;
        const rawMsg = err instanceof Error ? err.message : 'Не удалось распознать';
        let friendly = rawMsg;
        if (status === 413) {
          friendly = 'Фото слишком большое для сервера. Попробуй ещё раз — мы автоматически сжимаем, но иногда камера выдаёт слишком детальный кадр.';
        } else if (status === 400) {
          friendly = `Сервер не принял запрос: ${rawMsg}`;
        } else if (status === 500) {
          friendly = `Ошибка ИИ-распознавания: ${rawMsg}`;
        } else if (rawMsg.toLowerCase().includes('network')) {
          friendly = 'Нет связи с сервером. Проверь, что бэкенд запущен на твоём Mac и iPhone в той же Wi-Fi сети.';
        }
        Alert.alert('Ошибка', friendly);
      } finally {
        setAnalyzing(false);
      }
    },
    [token],
  );

  const saveFood = useCallback(async () => {
    if (!analysis || !token) return;
    setSaving(true);
    try {
      // Сервер ждёт строгую схему: foodName, calories(int), carbs, protein, fat, portion?
      // confidence/notes сюда передавать НЕЛЬЗЯ — Zod валидация отбросит запрос.
      const payload = {
        foodName: analysis.foodName,
        calories: Math.round(analysis.calories || 0),
        carbs: Math.max(0, analysis.carbs || 0),
        protein: Math.max(0, analysis.protein || 0),
        fat: Math.max(0, analysis.fat || 0),
        portion: analysis.portion || undefined,
      };
      await api.post('/vision/save-food', payload, token);
      setAnalysis(null);
      setImageUri(null);
      await loadToday();
      Alert.alert('Готово', 'Блюдо добавлено в дневник питания.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось сохранить';
      Alert.alert('Ошибка', msg);
    } finally {
      setSaving(false);
    }
  }, [analysis, token, loadToday]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="chevron-left" size={26} color={c.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Счётчик углеводов</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
      >
        {today && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Сегодня</Text>
            <View style={styles.summaryRow}>
              <SummaryStat label="Ккал" value={Math.round(today.calories)} color="#F59E0B" />
              <SummaryStat label="Углеводы" value={`${Math.round(today.carbs)} г`} color="#22C55E" />
              <SummaryStat label="Белки" value={`${Math.round(today.protein)} г`} color="#3B82F6" />
              <SummaryStat label="Жиры" value={`${Math.round(today.fat)} г`} color="#EF4444" />
            </View>
          </View>
        )}

        {imageUri && (
          <View style={styles.previewCard}>
            <Image source={{ uri: imageUri }} style={styles.preview} />
          </View>
        )}

        {analyzing && (
          <View style={styles.analyzingCard}>
            <ActivityIndicator color={c.primary} />
            <Text style={styles.analyzingText}>Распознаю блюдо…</Text>
          </View>
        )}

        {analysis && !analyzing && (
          <View style={styles.resultCard}>
            <Text style={styles.foodName}>{analysis.foodName}</Text>
            {!!analysis.portion && <Text style={styles.portion}>{analysis.portion}</Text>}
            <View style={styles.macrosGrid}>
              <MacroTile label="Калории" value={`${Math.round(analysis.calories)}`} unit="ккал" color="#F59E0B" />
              <MacroTile label="Углеводы" value={`${Math.round(analysis.carbs)}`} unit="г" color="#22C55E" />
              <MacroTile label="Белки" value={`${Math.round(analysis.protein)}`} unit="г" color="#3B82F6" />
              <MacroTile label="Жиры" value={`${Math.round(analysis.fat)}`} unit="г" color="#EF4444" />
            </View>
            {!!analysis.notes && <Text style={styles.notes}>{analysis.notes}</Text>}
            <Text style={styles.confidence}>
              Уверенность ИИ:{' '}
              {typeof analysis.confidence === 'number'
                ? `${Math.round(analysis.confidence * 100)}%`
                : (CONFIDENCE_LABEL[String(analysis.confidence)] ?? '—')}
            </Text>
            <TouchableOpacity style={styles.saveBtn} onPress={saveFood} disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.saveBtnText}>Добавить в дневник</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {!analysis && !analyzing && (
          <View style={styles.hintCard}>
            <Feather name="camera" size={32} color={c.primary} />
            <Text style={styles.hintTitle}>Сфотографируй еду</Text>
            <Text style={styles.hintText}>
              ИИ определит блюдо, посчитает калории, углеводы, белки и жиры
            </Text>
          </View>
        )}

        {today && Array.isArray(today.items) && today.items.length > 0 && (
          <View style={styles.historyCard}>
            <Text style={styles.historyTitle}>Сегодняшние блюда</Text>
            {today.items.map((item) => (
              <View key={item.id} style={styles.historyItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyName}>{item.foodName}</Text>
                  {!!item.portion && <Text style={styles.historyPortion}>{item.portion}</Text>}
                </View>
                <Text style={styles.historyCalories}>{Math.round(item.calories)} ккал</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.cameraBtn} onPress={pickFromCamera}>
          <Feather name="camera" size={22} color="#FFFFFF" />
          <Text style={styles.cameraBtnText}>Камера</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.libraryBtn} onPress={pickFromLibrary}>
          <Feather name="image" size={22} color={c.text} />
          <Text style={styles.libraryBtnText}>Галерея</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: string | number; color: string }): React.ReactElement {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <View style={styles.summaryStat}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function MacroTile({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }): React.ReactElement {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <View style={styles.macroTile}>
      <Text style={[styles.macroValue, { color }]}>{value}<Text style={styles.macroUnit}> {unit}</Text></Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: '600', color: c.text },
  content: { padding: 16, paddingBottom: 120 },
  summaryCard: {
    backgroundColor: c.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  summaryTitle: { fontSize: 14, color: c.textSecondary, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryStat: { alignItems: 'center', flex: 1 },
  summaryValue: { fontSize: 18, fontWeight: '700' },
  summaryLabel: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  previewCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  preview: { width: '100%', height: 220 },
  analyzingCard: {
    backgroundColor: c.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  analyzingText: { color: c.text, marginTop: 12, fontSize: 14 },
  resultCard: {
    backgroundColor: c.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  foodName: { fontSize: 20, fontWeight: '700', color: c.text },
  portion: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  macrosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 16,
    marginHorizontal: -4,
  },
  macroTile: {
    width: '50%',
    padding: 4,
  },
  macroValue: { fontSize: 22, fontWeight: '700' },
  macroUnit: { fontSize: 12, fontWeight: '500', color: c.textSecondary },
  macroLabel: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  notes: { fontSize: 13, color: c.textSecondary, marginTop: 12, fontStyle: 'italic' },
  confidence: { fontSize: 11, color: c.textSecondary, marginTop: 8 },
  saveBtn: {
    backgroundColor: c.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  hintCard: {
    backgroundColor: c.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  hintTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginTop: 12 },
  hintText: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 6 },
  historyCard: {
    backgroundColor: c.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  historyTitle: { fontSize: 14, color: c.textSecondary, marginBottom: 12 },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomColor: c.surfaceLight,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  historyName: { fontSize: 14, color: c.text, fontWeight: '500' },
  historyPortion: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  historyCalories: { fontSize: 13, color: c.warning, fontWeight: '600' },
  footer: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: 'row',
    gap: 12,
  },
  cameraBtn: {
    flex: 2,
    backgroundColor: c.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  cameraBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  libraryBtn: {
    flex: 1,
    backgroundColor: c.surface,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: c.surfaceLight,
  },
  libraryBtnText: { color: c.text, fontSize: 14, fontWeight: '500' },
  });
}
