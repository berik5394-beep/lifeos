import { describe, it, expect } from 'vitest';
import { mailTransport, smtpFrom } from './mailer.js';

describe('mailer — какой способ отправки (2026-11-11: на проде не было ни одного)', () => {
  it('ничего не настроено → null', () => {
    expect(mailTransport({})).toBeNull();
  });
  it('Gmail: SMTP_USER + SMTP_PASS → smtp', () => {
    expect(mailTransport({ SMTP_USER: 'a@gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop' })).toBe('smtp');
  });
  it('Resend настроен целиком → он в приоритете', () => {
    expect(mailTransport({ RESEND_API_KEY: 'k', MAIL_FROM: 'LifeOS <x@y.kz>', SMTP_USER: 'a', SMTP_PASS: 'b' })).toBe('resend');
  });
  it('Resend без MAIL_FROM — не считается, падаем на SMTP', () => {
    expect(mailTransport({ RESEND_API_KEY: 'k', SMTP_USER: 'a', SMTP_PASS: 'b' })).toBe('smtp');
  });
  it('отправитель SMTP: MAIL_FROM или «LifeOS <ящик>»', () => {
    expect(smtpFrom({ SMTP_USER: 'a@gmail.com' })).toBe('LifeOS <a@gmail.com>');
    expect(smtpFrom({ SMTP_USER: 'a@gmail.com', MAIL_FROM: 'LifeOS <a@gmail.com>' })).toBe('LifeOS <a@gmail.com>');
  });
});
