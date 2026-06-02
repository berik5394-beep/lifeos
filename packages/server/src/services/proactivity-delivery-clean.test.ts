import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PUSH = readFileSync(
  join(process.cwd(), 'src/services/push-service.ts'),
  'utf-8',
);
const INSIGHT = readFileSync(
  join(process.cwd(), 'src/services/insight-store.ts'),
  'utf-8',
);

describe('proactivity delivery — внутренний лейбл НЕ просачивается в текст', () => {
  it('push-service: пустой title → Telegram шлёт ТОЛЬКО body (без префикса)', () => {
    expect(PUSH).toContain('title ? `${title}');
    expect(PUSH).toContain('` : body)');
  });

  it('insight-store: deliverTopInsight НЕ передаёт row.rationale как заголовок', () => {
    const i = INSIGHT.indexOf('deliverNotification(');
    expect(i).toBeGreaterThan(-1);
    const body = INSIGHT.slice(i, i + 400);
    expect(body).not.toContain("row.rationale ?? 'JARVIS'");
    expect(body).toContain('row.message');
  });
});
