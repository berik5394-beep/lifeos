import React, { useCallback, useState , useMemo} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';

type ScheduleItem = {
  day: string;
  time: string;
  subject: string;
  room?: string;
  teacher?: string;
  notes?: string;
};

type ScheduleAnalysis = {
  title: string;
  items: ScheduleItem[];
};

export default function ScheduleImportScreen(): React.ReactElement {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation<any>();
  const token = useAuthStore((s) => s.token);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [analysis, setAnalysis] = useState<ScheduleAnalysis | null>(null);

  const analyzeSchedule = useCallback(
    async (base64: string) => {
      if (!token) return;
      setAnalyzing(true);
      try {
        const data = await api.post<ScheduleAnalysis>(
          '/vision/analyze-schedule',
          { imageBase64: base64 },
          token,
        );
        setAnalysis(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Не удалось распознать';
        Alert.alert('Ошибка', msg);
      } finally {
        setAnalyzing(false);
      }
    },
    [token],
  );

  const pickFromCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Нет доступа', 'Разреши доступ к камере.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      setImageUri(result.assets[0].uri);
      setAnalysis(null);
      await analyzeSchedule(result.assets[0].base64);
    }
  }, [analyzeSchedule]);

  const pickFromLibrary = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      setImageUri(result.assets[0].uri);
      setAnalysis(null);
      await analyzeSchedule(result.assets[0].base64);
    }
  }, [analyzeSchedule]);

  const importToTasks = useCallback(async () => {
    if (!analysis || !token) return;
    setImporting(true);
    try {
      const res = await api.post<{ created: number }>(
        '/vision/import-schedule',
        { items: analysis.items },
        token,
      );
      Alert.alert('Готово', `Добавлено ${res.created} уроков в задачи.`);
      navigation.goBack();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось импортировать';
      Alert.alert('Ошибка', msg);
    } finally {
      setImporting(false);
    }
  }, [analysis, token, navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="chevron-left" size={26} color={c.text} />
        </TouchableOpacity>
        <Text style={styles.title}>План уроков</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {imageUri && (
          <View style={styles.previewCard}>
            <Image source={{ uri: imageUri }} style={styles.preview} />
          </View>
        )}

        {analyzing && (
          <View style={styles.analyzingCard}>
            <ActivityIndicator color={c.primary} />
            <Text style={styles.analyzingText}>Распознаю расписание…</Text>
          </View>
        )}

        {!analysis && !analyzing && !imageUri && (
          <View style={styles.hintCard}>
            <Feather name="calendar" size={32} color={c.primary} />
            <Text style={styles.hintTitle}>Сфотографируй расписание</Text>
            <Text style={styles.hintText}>
              ИИ распознает уроки и автоматически добавит их в задачи с датами и временем
            </Text>
          </View>
        )}

        {analysis && !analyzing && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>{analysis.title}</Text>
            <Text style={styles.resultCount}>Найдено уроков: {analysis.items.length}</Text>
            {analysis.items.map((item, idx) => (
              <View key={idx} style={styles.lessonRow}>
                <View style={styles.lessonTime}>
                  <Text style={styles.lessonDay}>{item.day}</Text>
                  <Text style={styles.lessonHour}>{item.time}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lessonSubject}>{item.subject}</Text>
                  {!!item.room && <Text style={styles.lessonMeta}>Каб. {item.room}</Text>}
                  {!!item.teacher && <Text style={styles.lessonMeta}>{item.teacher}</Text>}
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.importBtn} onPress={importToTasks} disabled={importing}>
              {importing ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.importBtnText}>Добавить всё в задачи</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.cameraBtn} onPress={pickFromCamera}>
          <Feather name="camera" size={22} color="#FFFFFF" />
          <Text style={styles.cameraBtnText}>Сфотографировать</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.libraryBtn} onPress={pickFromLibrary}>
          <Feather name="image" size={22} color={c.text} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
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
  previewCard: { borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  preview: { width: '100%', height: 220 },
  analyzingCard: {
    backgroundColor: c.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  analyzingText: { color: c.text, marginTop: 12, fontSize: 14 },
  hintCard: {
    backgroundColor: c.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  hintTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginTop: 12 },
  hintText: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 6 },
  resultCard: {
    backgroundColor: c.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  resultTitle: { fontSize: 18, fontWeight: '700', color: c.text },
  resultCount: { fontSize: 12, color: c.textSecondary, marginTop: 4, marginBottom: 12 },
  lessonRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomColor: c.surfaceLight,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lessonTime: { width: 90 },
  lessonDay: { fontSize: 12, color: c.primary, fontWeight: '600', textTransform: 'uppercase' },
  lessonHour: { fontSize: 13, color: c.text, marginTop: 2 },
  lessonSubject: { fontSize: 14, color: c.text, fontWeight: '500' },
  lessonMeta: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  importBtn: {
    backgroundColor: c.success,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  importBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  footer: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: 'row',
    gap: 12,
  },
  cameraBtn: {
    flex: 3,
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
    width: 56,
    backgroundColor: c.surface,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.surfaceLight,
  },
  });
}
