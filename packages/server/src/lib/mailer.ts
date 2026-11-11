/**
 * Письма (сейчас — только код сброса пароля). Два способа, первый настроенный:
 *   1) Resend HTTP API — RESEND_API_KEY + MAIL_FROM (нужен свой домен);
 *   2) SMTP, по умолчанию Gmail — SMTP_USER + SMTP_PASS
 *      (для Gmail: SMTP_USER = адрес, SMTP_PASS = «пароль приложения»,
 *       myaccount.google.com/apppasswords; SMTP_HOST/SMTP_PORT — если не Gmail).
 *      Отправитель — MAIL_FROM или «LifeOS <SMTP_USER>».
 * До 2026-11-11 был только Resend, на проде не настроен → коды сброса никому
 * не уходили. Не настроено ничего → false, вызывающий сам решает, что делать.
 */
import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

type Transport = 'resend' | 'smtp' | null;

export function mailTransport(env: NodeJS.ProcessEnv = process.env): Transport {
  if (env.RESEND_API_KEY && env.MAIL_FROM) return 'resend';
  if (env.SMTP_USER && env.SMTP_PASS) return 'smtp';
  return null;
}

export function isMailConfigured(): boolean {
  return mailTransport() !== null;
}

/** Отправитель для SMTP (чистая): Gmail всё равно подставит адрес ящика. */
export function smtpFrom(env: NodeJS.ProcessEnv = process.env): string {
  return env.MAIL_FROM?.trim() || `LifeOS <${env.SMTP_USER}>`;
}

let smtp: nodemailer.Transporter | null = null;
function smtpTransporter(): nodemailer.Transporter {
  if (!smtp) {
    const port = Number(process.env.SMTP_PORT || 465);
    smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      // Пароль приложения Google показывают с пробелами — убираем их.
      auth: { user: process.env.SMTP_USER, pass: (process.env.SMTP_PASS ?? '').replace(/\s+/g, '') },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return smtp;
}

async function sendViaResend(msg: MailMessage, fetchImpl: typeof fetch): Promise<boolean> {
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.warn(`[mail] resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return false;
  }
  return true;
}

export async function sendMail(msg: MailMessage, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const via = mailTransport();
  if (!via) return false;
  try {
    if (via === 'resend') return await sendViaResend(msg, fetchImpl);
    await smtpTransporter().sendMail({ from: smtpFrom(), to: msg.to, subject: msg.subject, text: msg.text });
    return true;
  } catch (err) {
    console.warn(`[mail] ${via} send failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}
