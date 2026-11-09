import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { writeMemory } from './episodic-memory.js';
import { fetchV2EnrichmentData, buildV2EnrichmentBlock, formatRecentActivitySection } from './v2-enrichment.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function seedUser(email: string): Promise<string> {
  const u = await prisma.user.create({ data: { email, name: 'RA', passwordHash: 'x' } });
  return u.id;
}

const MARKER = 'медитировал всю неделю по цели духовный рост';

describe('M3 v2-натив: недавняя активность доходит до мозга (end-to-end, тест-БД)', () => {
  it('ДОКАЗАТЕЛЬСТВО: writeMemory → fetch → buildBlock содержит контент события', async () => {
    const userId = await seedUser(`ra-a-${Date.now()}@a.test`);
    await writeMemory(userId, { type: 'goal_progress_logged', content: MARKER });
    const data = await fetchV2EnrichmentData(userId);
    expect(data).not.toBeNull();
    const block = buildV2EnrichmentBlock(data!);
    expect(block).toContain('📌 Недавно');
    expect(block).toContain(MARKER);
  });

  it('cross-user: B не видит активность A', async () => {
    const a = await seedUser(`ra-c1-${Date.now()}@a.test`);
    const b = await seedUser(`ra-c2-${Date.now()}@a.test`);
    await writeMemory(a, { type: 'goal_progress_logged', content: MARKER });
    const data = await fetchV2EnrichmentData(b);
    const block = buildV2EnrichmentBlock(data!);
    expect(block).not.toContain(MARKER);
  });

  it('пустая память → нет секции (graceful)', async () => {
    const userId = await seedUser(`ra-d-${Date.now()}@a.test`);
    const data = await fetchV2EnrichmentData(userId);
    const block = buildV2EnrichmentBlock(data!);
    expect(block).not.toContain('📌 Недавно');
  });
});

describe('formatRecentActivitySection (pure)', () => {
  it('строки → секция с маркерами', () => {
    const s = formatRecentActivitySection([{ content: 'A' }, { content: 'B' }]);
    expect(s).toContain('📌 Недавно');
    expect(s).toContain('— A');
    expect(s).toContain('— B');
  });
  it('пусто → пустая строка', () => {
    expect(formatRecentActivitySection([])).toBe('');
  });
});
