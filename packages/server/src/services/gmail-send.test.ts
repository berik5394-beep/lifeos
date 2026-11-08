import { describe, it, expect } from 'vitest';
import { buildRawEmail, isEmail } from './gmail-send.js';
import { buildConfirmPrompt } from './confirm-prompt.js';

const decode = (raw: string) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

describe('письмо для Gmail', () => {
  it('RFC 2822: кому, тема в UTF-8, текст base64', () => {
    const mime = decode(buildRawEmail({ to: 'serik@mail.kz', subject: 'Прайс на турникеты', body: 'Серик, привет!\nПрайс пришлю завтра.' }));
    expect(mime).toContain('To: serik@mail.kz\r\n');
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('Прайс на турникеты').toString('base64')}?=`);
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    const body = mime.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('Серик, привет!\r\nПрайс пришлю завтра.');
  });
  it('перенос строки в теме/адресе не подмешивает заголовки', () => {
    const mime = decode(buildRawEmail({ to: 'a@b.kz\r\nBcc: evil@x.com', subject: 'Тема\r\nBcc: evil@x.com', body: 'x' }));
    expect(mime).not.toMatch(/\r\nBcc:/);
  });
  it('isEmail', () => {
    expect(isEmail('serik@mail.kz')).toBe(true);
    expect(isEmail('Серик')).toBe(false);
    expect(isEmail('a@b')).toBe(false);
  });
  it('черновик целиком в подтверждении', () => {
    expect(buildConfirmPrompt('send_email', { to: 'Серик', subject: 'Прайс', body: 'Пришлю завтра.' })).toBe(
      'Отправить письмо Серик?\nТема: «Прайс»\n\nПришлю завтра.\n\nНапиши «да» — отправлю.',
    );
  });
});
