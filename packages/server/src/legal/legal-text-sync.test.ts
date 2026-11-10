import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Политика в приложении и на сайте — один текст (копия файла байт-в-байт). */
describe('legal-text — сервер и приложение совпадают', () => {
  const server = fileURLToPath(new URL('./legal-text.ts', import.meta.url));
  const mobile = fileURLToPath(new URL('../../../../apps/mobile/constants/legal-text.ts', import.meta.url));
  it.skipIf(!existsSync(mobile))('файлы одинаковые', () => {
    expect(readFileSync(mobile, 'utf8')).toBe(readFileSync(server, 'utf8'));
  });
});
