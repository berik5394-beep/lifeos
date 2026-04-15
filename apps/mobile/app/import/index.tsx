import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
// File upload via fetch + FormData
import { useAuthStore } from '@/stores/auth-store';
import { Card, Button } from '@/components/ui';
import { spacing, fontSize, borderRadius } from '@/constants';
import { useColors } from '@/hooks/use-colors';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

const FILE_TYPE_LABELS: Record<string, string> = {
  xlsx: 'Excel',
  xls: 'Excel',
  csv: 'CSV',
  ics: 'Календарь',
  pdf: 'PDF',
};

const PURPOSE_COLORS: Record<string, string> = {
  expenses: '#F59E0B',
  incomes: '#22C55E',
  tasks: '#3B82F6',
  events: '#8B5CF6',
  unknown: '#94A3B8',
};

const PURPOSE_LABELS: Record<string, string> = {
  expenses: 'Расходы',
  incomes: 'Доходы',
  tasks: 'Задачи',
  events: 'События',
  unknown: 'Не определено',
};

interface ImportPreviewItem {
  [key: string]: unknown;
}

interface ImportResult {
  purpose: string;
  itemCount: number;
  preview: ImportPreviewItem[];
}

interface ImportHistoryItem {
  id: string;
  fileName: string;
  fileType: string;
  purpose: string;
  itemCount: number;
  createdAt: string;
}

export default function ImportScreen() {
  const { token } = useAuthStore();
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!token) return;
    setIsLoadingHistory(true);
    try {
      const response = await fetch(`${API_URL}/import/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = (await response.json()) as ImportHistoryItem[];
        setHistory(data);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingHistory(false);
    }
  }, [token]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handlePickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
          'text/calendar',
          'application/pdf',
        ],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets.length > 0) {
        setSelectedFile(result.assets[0]);
        setImportResult(null);
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось выбрать файл');
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!selectedFile || !token) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: selectedFile.uri,
        name: selectedFile.name,
        type: selectedFile.mimeType || 'application/octet-stream',
      } as unknown as Blob);

      const response = await fetch(`${API_URL}/import/file`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (response.ok) {
        const data = (await response.json()) as ImportResult;
        setImportResult(data);
        setSelectedFile(null);
        loadHistory();
      } else {
        const errorData = (await response.json()) as { message?: string };
        Alert.alert('Ошибка', errorData.message ?? 'Не удалось загрузить файл');
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось загрузить файл');
    } finally {
      setIsUploading(false);
    }
  }, [selectedFile, token, loadHistory]);

  const handleDeleteHistoryItem = useCallback(
    async (id: string) => {
      if (!token) return;

      Alert.alert('Удалить запись', 'Вы уверены?', [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`${API_URL}/import/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              setHistory((prev) => prev.filter((item) => item.id !== id));
            } catch {
              Alert.alert('Ошибка', 'Не удалось удалить');
            }
          },
        },
      ]);
    },
    [token],
  );

  const getFileExtension = (name: string): string => {
    const parts = name.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.screenTitle}>Импорт файлов</Text>

      {/* File picker */}
      <Card>
        <Text style={styles.cardTitle}>Выбрать файл</Text>
        <Text style={styles.hint}>
          Поддерживаемые форматы: xlsx, xls, csv, ics, pdf
        </Text>

        <Button
          title="Выбрать файл"
          onPress={handlePickFile}
          style={styles.pickButton}
        />

        {selectedFile != null && (
          <View style={styles.selectedFile}>
            <View style={styles.fileInfo}>
              <Text style={styles.fileName}>{selectedFile.name}</Text>
              <View style={styles.fileTypeBadge}>
                <Text style={styles.fileTypeText}>
                  {FILE_TYPE_LABELS[getFileExtension(selectedFile.name)] ?? getFileExtension(selectedFile.name).toUpperCase()}
                </Text>
              </View>
            </View>

            <Button
              title={isUploading ? 'Загрузка...' : 'Загрузить'}
              onPress={handleUpload}
              disabled={isUploading}
              style={styles.uploadButton}
            />
          </View>
        )}

        {isUploading && (
          <ActivityIndicator
            size="small"
            color={c.primary}
            style={styles.loader}
          />
        )}
      </Card>

      {/* Import result */}
      {importResult != null && (
        <View style={styles.resultSection}>
          <Text style={styles.sectionTitle}>Результат импорта</Text>
          <Card>
            <View style={styles.resultHeader}>
              <View
                style={[
                  styles.purposeBadge,
                  { backgroundColor: PURPOSE_COLORS[importResult.purpose] ?? PURPOSE_COLORS.unknown },
                ]}
              >
                <Text style={styles.purposeText}>
                  {PURPOSE_LABELS[importResult.purpose] ?? importResult.purpose}
                </Text>
              </View>
              <Text style={styles.itemCount}>
                {importResult.itemCount} записей
              </Text>
            </View>

            {importResult.preview.length > 0 && (
              <View style={styles.previewSection}>
                <Text style={styles.previewTitle}>Предпросмотр:</Text>
                {importResult.preview.slice(0, 5).map((item, index) => (
                  <View key={index} style={styles.previewItem}>
                    <Text style={styles.previewText} numberOfLines={2}>
                      {Object.values(item)
                        .filter((v) => v != null)
                        .join(' | ')}
                    </Text>
                  </View>
                ))}
                {importResult.preview.length > 5 && (
                  <Text style={styles.previewMore}>
                    ...и ещё {importResult.preview.length - 5}
                  </Text>
                )}
              </View>
            )}
          </Card>
        </View>
      )}

      {/* History */}
      <Text style={styles.sectionTitle}>История импорта</Text>
      {isLoadingHistory ? (
        <ActivityIndicator
          size="small"
          color={c.primary}
          style={styles.loader}
        />
      ) : history.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>Нет импортированных файлов</Text>
        </Card>
      ) : (
        history.map((item) => (
          <Card key={item.id} style={styles.historyCard}>
            <View style={styles.historyRow}>
              <View style={styles.historyInfo}>
                <Text style={styles.historyFileName} numberOfLines={1}>
                  {item.fileName}
                </Text>
                <View style={styles.historyMeta}>
                  <View
                    style={[
                      styles.purposeBadgeSmall,
                      { backgroundColor: PURPOSE_COLORS[item.purpose] ?? PURPOSE_COLORS.unknown },
                    ]}
                  >
                    <Text style={styles.purposeTextSmall}>
                      {PURPOSE_LABELS[item.purpose] ?? item.purpose}
                    </Text>
                  </View>
                  <Text style={styles.historyDate}>
                    {new Date(item.createdAt).toLocaleDateString('ru-RU')}
                  </Text>
                  <Text style={styles.historyCount}>
                    {item.itemCount} шт.
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => handleDeleteHistoryItem(item.id)}
                style={styles.deleteButton}
                activeOpacity={0.7}
              >
                <Text style={styles.deleteIcon}>🗑</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  content: {
    padding: spacing.md,
    paddingTop: spacing.xl + 32,
    paddingBottom: spacing.xl,
  },
  screenTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: c.text,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: c.text,
    marginBottom: spacing.xs,
  },
  hint: {
    fontSize: fontSize.sm,
    color: c.textSecondary,
    marginBottom: spacing.md,
  },
  pickButton: {
    marginBottom: spacing.sm,
  },
  selectedFile: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: c.surfaceLight,
    borderRadius: borderRadius.md,
  },
  fileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  fileName: {
    fontSize: fontSize.md,
    color: c.text,
    fontWeight: '500',
    flex: 1,
    marginRight: spacing.sm,
  },
  fileTypeBadge: {
    backgroundColor: c.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  fileTypeText: {
    fontSize: fontSize.xs,
    color: c.text,
    fontWeight: '600',
  },
  uploadButton: {
    width: '100%',
  },
  loader: {
    marginTop: spacing.md,
  },
  resultSection: {
    marginTop: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: c.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  purposeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  purposeText: {
    fontSize: fontSize.sm,
    color: c.text,
    fontWeight: '600',
  },
  itemCount: {
    fontSize: fontSize.md,
    color: c.textSecondary,
    fontWeight: '500',
  },
  previewSection: {
    marginTop: spacing.sm,
  },
  previewTitle: {
    fontSize: fontSize.sm,
    color: c.textSecondary,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  previewItem: {
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  previewText: {
    fontSize: fontSize.sm,
    color: c.text,
  },
  previewMore: {
    fontSize: fontSize.xs,
    color: c.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: c.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  historyCard: {
    marginBottom: spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  historyFileName: {
    fontSize: fontSize.md,
    color: c.text,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  historyMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  purposeBadgeSmall: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  purposeTextSmall: {
    fontSize: fontSize.xs,
    color: c.text,
    fontWeight: '600',
  },
  historyDate: {
    fontSize: fontSize.xs,
    color: c.textSecondary,
  },
  historyCount: {
    fontSize: fontSize.xs,
    color: c.textSecondary,
  },
  deleteButton: {
    padding: spacing.sm,
  },
  deleteIcon: {
    fontSize: 18,
  },
  });
}
