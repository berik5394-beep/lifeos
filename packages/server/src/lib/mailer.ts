/**
 * Письма (сейчас — только код сброса пароля). Через Resend HTTP API, без
 * зависимостей. Включается переменными окружения:
 *   RESEND_API_KEY — ключ Resend;
 *   MAIL_FROM      — отправитель с подтверждённого в Resend домена,
 *                    например «LifeOS <no-reply@lifeos.app>».
 * Не настроено → письма не уходят (false), вызывающий сам решает, что делать.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export function isMailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;
}

export async function sendMail(msg: MailMessage, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!isMailConfigured()) return false;
  try {
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
  } catch (err) {
    console.warn('[mail] send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
