import { describe, it, expect } from 'vitest';
import { mailTransport, smtpFrom, parseFrom, sendMail, isMailWorking, _resetMailHealth } from './mailer.js';

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

describe('mailer — Brevo (HTTP; SMTP на Railway Hobby закрыт)', () => {
  it('BREVO_API_KEY + MAIL_FROM → brevo, раньше SMTP', () => {
    expect(mailTransport({ BREVO_API_KEY: 'k', MAIL_FROM: 'LifeOS <a@gmail.com>', SMTP_USER: 'a', SMTP_PASS: 'b' })).toBe('brevo');
  });
  it('Brevo без MAIL_FROM — не считается', () => {
    expect(mailTransport({ BREVO_API_KEY: 'k' })).toBeNull();
  });
  it('parseFrom: имя и адрес', () => {
    expect(parseFrom('LifeOS <a@gmail.com>')).toEqual({ name: 'LifeOS', email: 'a@gmail.com' });
    expect(parseFrom('a@gmail.com')).toEqual({ email: 'a@gmail.com' });
  });
  it('sendMail шлёт в Brevo правильное тело', async () => {
    const env = { ...process.env };
    Object.assign(process.env, { BREVO_API_KEY: 'k', MAIL_FROM: 'LifeOS <a@gmail.com>' });
    delete process.env.RESEND_API_KEY;
    let body: Record<string, unknown> = {};
    let url = '';
    const fake = (async (u: string, init: RequestInit) => { url = u; body = JSON.parse(String(init.body)); return new Response('{}', { status: 201 }); }) as unknown as typeof fetch;
    try {
      expect(await sendMail({ to: 'x@mail.ru', subject: 'Код', text: '123456' }, fake)).toBe(true);
      expect(url).toBe('https://api.brevo.com/v3/smtp/email');
      expect(body).toEqual({ sender: { name: 'LifeOS', email: 'a@gmail.com' }, to: [{ email: 'x@mail.ru' }], subject: 'Код', textContent: '123456' });
    } finally {
      process.env = env;
    }
  });
});

describe('mailer — настроено ≠ работает', () => {
  it('после провала отправки isMailWorking=false, после успеха снова true', async () => {
    const env = { ...process.env };
    Object.assign(process.env, { BREVO_API_KEY: 'k', MAIL_FROM: 'LifeOS <a@gmail.com>' });
    delete process.env.RESEND_API_KEY;
    _resetMailHealth();
    const resp = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch;
    try {
      expect(isMailWorking()).toBe(true);
      expect(await sendMail({ to: 'x@mail.ru', subject: 's', text: 't' }, resp(401))).toBe(false);
      expect(isMailWorking()).toBe(false);
      await new Promise((r) => setTimeout(r, 2));
      expect(await sendMail({ to: 'x@mail.ru', subject: 's', text: 't' }, resp(201))).toBe(true);
      expect(isMailWorking()).toBe(true);
    } finally {
      process.env = env;
      _resetMailHealth();
    }
  });
});
