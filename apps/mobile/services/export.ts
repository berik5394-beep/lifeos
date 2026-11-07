import { cacheDirectory, EncodingType, writeAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Экспорт данных — один сервис для всех экранов (Экспорт, Интеграции,
 * Настройки). Раньше экраны ждали от сервера JSON, а сервер отдаёт CSV-текст,
 * PDF и SVG: «Отчёт» и «История» всегда падали, а в Интеграциях кнопки
 * писали «Готово», ничего не создав.
 */
export type ExportModule = 'finance' | 'habits' | 'tasks';
export type ReportPeriod = 'month' | 'year';

const today = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function token(): string {
  const t = useAuthStore.getState().token;
  if (!t) throw new Error('Войдите в аккаунт, чтобы выгрузить данные');
  return t;
}

async function share(uri: string, mimeType: string, UTI: string, dialogTitle: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('На этом устройстве нельзя поделиться файлом');
  await Sharing.shareAsync(uri, { mimeType, UTI, dialogTitle });
}

/** CSV модуля → файл → меню «Поделиться» (сохранить в Файлы, отправить). */
export async function exportCSV(module: ExportModule): Promise<void> {
  const res = await api.postRaw(`/export/csv/${module}`, undefined, token());
  if (!res.ok) throw new Error('Сервер не отдал файл, попробуйте ещё раз');
  const uri = `${cacheDirectory}lifeos_${module}_${today()}.csv`;
  await writeAsStringAsync(uri, await res.text());
  await share(uri, 'text/csv', 'public.comma-separated-values-text', 'Экспорт LifeOS');
}

/** PDF-отчёт за месяц/год → файл → «Поделиться». */
export async function exportReport(period: ReportPeriod): Promise<void> {
  // base64 в JSON: читать бинарный ответ fetch в React Native ненадёжно.
  const data = await api.post<{ filename?: string; base64?: string }>(
    '/export/pdf/report',
    { period, format: 'base64' },
    token(),
  );
  if (!data.base64) throw new Error('Сервер не прислал отчёт, попробуйте ещё раз');
  const uri = `${cacheDirectory}${data.filename ?? `lifeos-report-${today()}.pdf`}`;
  await writeAsStringAsync(uri, data.base64, { encoding: EncodingType.Base64 });
  await share(uri, 'application/pdf', 'com.adobe.pdf', 'Отчёт LifeOS');
}

/** Текст «мой прогресс» для сторис/мессенджера (SVG они не принимают). */
export async function progressStoryText(): Promise<string> {
  const data = await api.post<{ title?: string; stats?: Array<{ label: string; value: string }> }>(
    '/export/story',
    { format: 'json' },
    token(),
  );
  if (!data.stats || data.stats.length === 0) throw new Error('Не удалось собрать прогресс, попробуйте ещё раз');
  return [`🚀 ${data.title ?? 'Мой прогресс в LifeOS'}`, '', ...data.stats.map((s) => `${s.label}: ${s.value}`), '', '#LifeOS'].join('\n');
}
