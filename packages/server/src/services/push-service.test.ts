import { describe, it, expect } from 'vitest';
import { isDeadTokenError, isTelegramChatGone } from './push-service.js';

describe('isDeadTokenError', () => {
  it('DeviceNotRegistered → true', () => {
    expect(isDeadTokenError('DeviceNotRegistered')).toBe(true);
  });
  it('невалидный формат токена → true (раньше не чистился)', () => {
    expect(
      isDeadTokenError('"ExponentPushToken[test123abc]" is not a valid Expo push token'),
    ).toBe(true);
  });
  it('прочие ошибки → false (не трогаем токен)', () => {
    expect(isDeadTokenError('MessageRateExceeded')).toBe(false);
    expect(isDeadTokenError('')).toBe(false);
    expect(isDeadTokenError(null)).toBe(false);
    expect(isDeadTokenError(undefined)).toBe(false);
  });
});

describe('isTelegramChatGone', () => {
  it('бот заблокирован / чат не найден / аккаунт удалён → true (зеркало выключаем)', () => {
    expect(isTelegramChatGone('403: Forbidden: bot was blocked by the user')).toBe(true);
    expect(isTelegramChatGone('400: Bad Request: chat not found')).toBe(true);
    expect(isTelegramChatGone('403: Forbidden: user is deactivated')).toBe(true);
  });
  it('временные сбои → false (повторим позже)', () => {
    expect(isTelegramChatGone('429: Too Many Requests: retry after 5')).toBe(false);
    expect(isTelegramChatGone('ETIMEDOUT')).toBe(false);
    expect(isTelegramChatGone(undefined)).toBe(false);
  });
});
