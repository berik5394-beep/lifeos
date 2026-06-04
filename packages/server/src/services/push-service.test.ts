import { describe, it, expect } from 'vitest';
import { isDeadTokenError } from './push-service.js';

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
