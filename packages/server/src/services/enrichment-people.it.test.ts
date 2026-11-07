import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { entityFacts, entityRelationshipLines, fetchV2EnrichmentData, buildV2EnrichmentBlock } from './v2-enrichment.js';

/** Этап 4: атрибуты людей и связи — писались в память, но в промпт не попадали. */
const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe('entityFacts', () => {
  it('короткие атрибуты; ДР/тип/служебные и длинные — мимо', () => {
    expect(entityFacts({ company: 'Казахтелеком', city: 'Астана', birthday: '08-06', personType: 'family', _src: 'x', bio: 'x'.repeat(80) }))
      .toBe('company: Казахтелеком, city: Астана');
    expect(entityFacts(null)).toBe('');
    expect(entityFacts(['a'])).toBe('');
  });
});

describe('люди в блоке памяти', () => {
  it('атрибут и связь «Серик — брат — Дана» доходят до текста промпта', async () => {
    process.env.FEATURE_V2_MEMORY = 'all';
    const userId = (
      await prisma.user.create({ data: { email: `ep-${Date.now()}-${Math.random()}@a.test`, name: 'E', passwordHash: 'x', timezone: 'UTC' } })
    ).id;
    const serik = await prisma.entity.create({ data: { userId, type: 'person', name: 'Серик', importance: 9, attributes: { company: 'Казахтелеком' } } });
    const dana = await prisma.entity.create({ data: { userId, type: 'person', name: 'Дана', importance: 8 } });
    await prisma.entityRelationship.create({ data: { userId, fromId: serik.id, toId: dana.id, type: 'family', label: 'брат' } });

    expect(await entityRelationshipLines(userId, [serik.id])).toEqual(['Серик — брат — Дана']);
    const data = await fetchV2EnrichmentData(userId);
    const block = buildV2EnrichmentBlock(data!);
    expect(block).toContain('Серик: company: Казахтелеком');
    expect(block).toContain('связи между людьми: Серик — брат — Дана');
  });
});
