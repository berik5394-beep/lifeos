import type { FastifyInstance } from 'fastify';
import {
  LEGAL_UPDATED,
  PRIVACY_SECTIONS,
  SUPPORT_EMAIL,
  TERMS_SECTIONS,
  type LegalSection,
} from '../legal/legal-text.js';

/**
 * Публичные страницы без входа — ссылки для App Store Connect и Google Play:
 * /privacy (Privacy Policy URL), /terms (условия), /support (Support URL).
 * Текст — общий с приложением (src/legal/legal-text.ts = apps/mobile/constants/legal-text.ts),
 * раньше здесь жила своя копия и расходилась с экраном в приложении.
 */

const CONTACT_EMAIL = process.env.SUPPORT_EMAIL || SUPPORT_EMAIL;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Текст раздела → HTML: строки «- …» — список, остальное — абзацы. */
function renderBody(body: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const raw of body.replaceAll(SUPPORT_EMAIL, CONTACT_EMAIL).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('- ')) list.push(line.slice(2));
    else {
      flush();
      out.push(`<p>${esc(line)}</p>`);
    }
  }
  flush();
  return out.join('\n');
}

function page(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LifeOS — ${esc(title)}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px;line-height:1.55;color:#0F172A}h1{font-size:24px}h2{font-size:18px;margin-top:28px}li{margin:6px 0}.muted{color:#64748B;font-size:14px}a{color:#4F46E5}</style>
</head><body>
<h1>LifeOS — ${esc(title)}</h1>
${content}
<p class="muted">Контакт: <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a> · <a href="/privacy">Конфиденциальность</a> · <a href="/terms">Условия</a> · <a href="/support">Поддержка</a></p>
</body></html>`;
}

function renderSections(title: string, sections: LegalSection[]): string {
  const body = sections.map((s) => `<h2>${esc(s.title)}</h2>\n${renderBody(s.body)}`).join('\n');
  return page(title, `<p class="muted">Дата обновления: ${esc(LEGAL_UPDATED)}</p>\n${body}`);
}

export function renderPrivacyHtml(): string {
  return renderSections('Политика конфиденциальности', PRIVACY_SECTIONS);
}

export function renderTermsHtml(): string {
  return renderSections('Условия использования', TERMS_SECTIONS);
}

export function renderSupportHtml(): string {
  return page(
    'Поддержка',
    `<p>LifeOS — личный помощник: задачи, привычки, цели, финансы и робот-друг, который всё это помнит.</p>
<h2>Как связаться</h2>
<p>Напишите на <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a> — ответим в течение 2 рабочих дней.</p>
<h2>Частые вопросы</h2>
<ul>
<li>Как удалить аккаунт и все данные? «Настройки → Удалить аккаунт» в приложении — данные стираются с сервера.</li>
<li>Как выгрузить данные? «Настройки → Экспорт» — все данные одним файлом (JSON) или разделы в CSV.</li>
<li>Робот грубит? Это стиль «Токсичный мотиватор» — смените стиль в «Настройках».</li>
<li>Не работает голос? Разрешите доступ к микрофону в настройках iPhone → LifeOS.</li>
</ul>`,
  );
}

export async function legalPageRoutes(app: FastifyInstance): Promise<void> {
  // Публично, без auth. Свой CSP: разрешаем только встроенный стиль страницы.
  const html = (render: () => string) => async (_request: unknown, reply: import('fastify').FastifyReply) => {
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    reply.type('text/html; charset=utf-8');
    return render();
  };
  app.get('/privacy', html(renderPrivacyHtml));
  app.get('/terms', html(renderTermsHtml));
  app.get('/support', html(renderSupportHtml));
}
