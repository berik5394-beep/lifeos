import { buildCrashPayload, resetCrashThrottle, shouldSendCrash } from '@/services/crash-reporting';

/** 2026-11-10: сбои у пользователя уходят на сервер (раньше — только консоль телефона). */
describe('отчёт о сбое', () => {
  beforeEach(() => resetCrashThrottle());
  it('текст, стек, экран — без лишнего', () => {
    const e = new Error('undefined is not an object');
    const p = buildCrashPayload(e, { componentStack: 'in Finance', route: 'Home', fatal: true, appVersion: '1.0.0' });
    expect(p.message).toBe('undefined is not an object');
    expect(p.stack).toContain('undefined is not an object');
    expect(p).toMatchObject({ componentStack: 'in Finance', route: 'Home', fatal: true, appVersion: '1.0.0' });
  });
  it('не-Error тоже превращается в отчёт; длинное режется', () => {
    expect(buildCrashPayload('строка').message).toBe('строка');
    expect(buildCrashPayload(new Error('x'.repeat(900))).message).toHaveLength(500);
  });
  it('один и тот же сбой — не чаще раза в минуту; за запуск не больше 20', () => {
    expect(shouldSendCrash('a', 0)).toBe(true);
    expect(shouldSendCrash('a', 30_000)).toBe(false);
    expect(shouldSendCrash('a', 61_000)).toBe(true);
    for (let i = 0; i < 30; i++) shouldSendCrash(`k${i}`, 100_000);
    expect(shouldSendCrash('new', 200_000)).toBe(false);
  });
});
