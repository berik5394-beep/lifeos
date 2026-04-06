import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { File, Paths } from 'expo-file-system';

// TODO: Add expo-sharing for native share sheet support when needed.

type ExportModule = 'finance' | 'habits' | 'tasks';

interface ExportReport {
  title: string;
  period: string;
  data: Record<string, unknown>;
  generatedAt: string;
}

interface ExportStory {
  imageUrl?: string;
  text: string;
  stats: Record<string, unknown>;
}

export async function exportCSV(module: ExportModule): Promise<string> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Не авторизован');

  try {
    const data = await api.post<{ csv: string }>(
      `/export/csv/${module}`,
      {},
      token,
    );
    return data.csv;
  } catch (err) {
    console.error(`Ошибка экспорта ${module} в CSV:`, err);
    throw err;
  }
}

export async function exportPDFReport(
  period: 'month' | 'year',
  date?: string,
): Promise<ExportReport> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Не авторизован');

  try {
    const data = await api.post<ExportReport>(
      '/export/pdf/report',
      { period, date },
      token,
    );
    return data;
  } catch (err) {
    console.error('Ошибка экспорта PDF отчёта:', err);
    throw err;
  }
}

export async function exportStory(): Promise<ExportStory> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Не авторизован');

  try {
    const data = await api.post<ExportStory>('/export/story', {}, token);
    return data;
  } catch (err) {
    console.error('Ошибка генерации Stories:', err);
    throw err;
  }
}

export function saveCSVToFile(
  csv: string,
  filename: string,
): string | null {
  try {
    const file = new File(Paths.document, filename);
    file.write(csv);
    return file.uri;
  } catch (err) {
    console.error('Ошибка сохранения CSV файла:', err);
    return null;
  }
}
