import * as Sharing from 'expo-sharing';
import * as FS from 'expo-file-system/legacy';
import { api } from '@/services/api';
import { exportCSV, exportReport, progressStoryText } from '@/services/export';

/**
 * Аудит 2026-11-07: сервер отдаёт CSV-текст / PDF / статы, а экраны ждали
 * другой JSON — «Отчёт» и «История» падали, Интеграции писали «Готово» впустую.
 */
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  writeAsStringAsync: jest.fn(async () => undefined),
}));

const mockApi = api as jest.Mocked<typeof api>;
const share = Sharing.shareAsync as jest.Mock;
const write = FS.writeAsStringAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

it('CSV: текст ответа → файл → «Поделиться»', async () => {
  mockApi.postRaw = jest.fn(async () => ({ ok: true, text: async () => '﻿Тип,Дата' }) as unknown as Response);
  await exportCSV('finance');
  expect(write.mock.calls[0][1]).toBe('﻿Тип,Дата');
  expect(share.mock.calls[0][0]).toMatch(/lifeos_finance_.*\.csv$/);
});

it('отчёт: base64 → PDF-файл → «Поделиться»', async () => {
  mockApi.post.mockResolvedValueOnce({ filename: 'lifeos-report-2026-11-01.pdf', base64: 'JVBERi0=' });
  await exportReport('month');
  expect(mockApi.post.mock.calls[0][1]).toEqual({ period: 'month', format: 'base64' });
  expect(write).toHaveBeenCalledWith('file:///cache/lifeos-report-2026-11-01.pdf', 'JVBERi0=', { encoding: 'base64' });
  expect(share.mock.calls[0][1]).toMatchObject({ mimeType: 'application/pdf' });
});

it('отчёт без данных — честная ошибка, а не «Готово»', async () => {
  mockApi.post.mockResolvedValueOnce({});
  await expect(exportReport('year')).rejects.toThrow(/не прислал/);
  expect(share).not.toHaveBeenCalled();
});

it('история: строки статов в тексте', async () => {
  mockApi.post.mockResolvedValueOnce({ title: 'Мой прогресс в LifeOS', stats: [{ label: 'Серия', value: '5 дн' }] });
  const t = await progressStoryText();
  expect(t).toContain('Серия: 5 дн');
});
