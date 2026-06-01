import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'events.ts'), 'utf8');

describe('routes/events — M1 хуки [B] captureActivity', () => {
  it('импортирует captureActivity', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*captureActivity[^}]*\}\s*from\s*'\.\.\/services\/tool-activity-summary\.js'/,
    );
  });
  it('POST /events → event_created (роут пишет inline, не через create_event tool)', () => {
    expect(SRC).toMatch(/type:\s*'event_created'/);
  });
  it('PUT /events/:id → event_updated', () => {
    expect(SRC).toMatch(/type:\s*'event_updated'/);
  });
  it('captureActivity не await-ится', () => {
    expect(SRC).not.toMatch(/await captureActivity\(/);
  });
});
