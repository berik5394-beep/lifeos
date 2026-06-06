import { getDeviceTimezone } from '../device-tz';

describe('getDeviceTimezone', () => {
  it('возвращает непустую строку (IANA-пояс или фолбэк)', () => {
    const tz = getDeviceTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });
});
