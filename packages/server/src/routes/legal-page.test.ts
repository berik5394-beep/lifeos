import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { legalPageRoutes, renderPrivacyHtml } from './legal-page.js';
import { registerSecurityHeaders } from '../middleware/security.js';

describe('/privacy — публичная политика конфиденциальности', () => {
  it('отдаёт HTML без входа, со стилем (свой CSP не затёрт)', async () => {
    const app = Fastify();
    registerSecurityHeaders(app);
    await app.register(legalPageRoutes);
    const res = await app.inject({ method: 'GET', url: '/privacy' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['content-security-policy']).toMatch(/style-src 'unsafe-inline'/);
    expect(res.body).toMatch(/Политика конфиденциальности/);
    await app.close();
  });
  it('называет всех фактических обработчиков данных', () => {
    const html = renderPrivacyHtml();
    for (const p of ['Anthropic', 'Groq', 'Voyage AI', 'Google', 'Expo', 'Railway']) expect(html).toContain(p);
    expect(html).toMatch(/Удалить аккаунт/);
  });
});

describe('/terms и /support — ссылки для App Store Connect (2026-11-10)', () => {
  it('отдаются без входа', async () => {
    const app = Fastify();
    registerSecurityHeaders(app);
    await app.register(legalPageRoutes);
    for (const [url, text] of [['/terms', 'Условия использования'], ['/support', 'Поддержка']] as const) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(text);
    }
    await app.close();
  });
  it('согласие на сторонний ИИ описано в политике', () => {
    expect(renderPrivacyHtml()).toMatch(/явного согласия/);
  });
});
