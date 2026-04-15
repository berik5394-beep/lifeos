/**
 * Симметричное шифрование AES-256-GCM для секретов в БД (OAuth-токены и т.п.).
 *
 * Используется для Google Calendar accessToken/refreshToken — даже если БД утечёт,
 * без ENCRYPTION_KEY злоумышленник не сможет расшифровать токены.
 *
 * Формат хранения: base64(iv | authTag | ciphertext) — всё в одной строке.
 *
 * ENCRYPTION_KEY должен быть 32 байта в hex-формате (64 hex-символа).
 * Сгенерировать: openssl rand -hex 32
 *
 * ВАЖНО: при ротации ключа все ранее зашифрованные значения станут нечитаемыми.
 * Перед ротацией нужна миграция: расшифровать старым → зашифровать новым.
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM рекомендует 96-bit IV
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error(
      'ENCRYPTION_KEY не задан. Сгенерируй: openssl rand -hex 32 и добавь в .env',
    );
  }
  if (keyHex.length !== 64) {
    throw new Error(
      `ENCRYPTION_KEY должен быть 64 hex-символа (32 байта), получено ${keyHex.length}`,
    );
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Шифрует строку. Возвращает base64-строку для хранения в БД.
 * Безопасно вызывать с пустой строкой (вернёт пустую).
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return '';
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Формат: iv (12) | authTag (16) | ciphertext
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Расшифровывает строку обратно в plaintext.
 * Если значение не зашифровано (старое plain-text из миграции) — возвращает как есть.
 */
export function decrypt(ciphertextB64: string): string {
  if (!ciphertextB64) return '';
  // Эвристика: зашифрованные значения всегда длиннее 28 символов в base64
  // (12 IV + 16 AuthTag = 28 байт = 40 base64-символов минимум)
  // и состоят только из base64-алфавита. Если строка короче или содержит
  // нестандартные символы — считаем её plain-text (legacy данные).
  if (ciphertextB64.length < 40 || !/^[A-Za-z0-9+/=]+$/.test(ciphertextB64)) {
    return ciphertextB64;
  }
  try {
    const key = getKey();
    const buf = Buffer.from(ciphertextB64, 'base64');
    if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      return ciphertextB64; // не наш формат
    }
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // Если расшифровать не удалось — возвращаем оригинал.
    // Это безопасно: legacy plain-text токены продолжат работать.
    return ciphertextB64;
  }
}
