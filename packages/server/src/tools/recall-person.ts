import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getRelevantMemories } from '../services/memory-service.js';
import { defineTool } from './_types.js';
import { entityFacts, entityRelationshipLines } from '../services/v2-enrichment.js';

/**
 * SSOT 9A.4 — миграция agent-only read-tool recall_person в реестр.
 * Логика 1:1 с прежним runLocalTool('recall_person') (Phase 2.1
 * связка person↔ContactCache + память). claude-agent свич — 9A.8.
 */
export const recallPersonTool = defineTool({
  name: 'recall_person',
  description:
    'Вспомнить человека: контакт (телефон/email/др.) + что юзер ' +
    'про него говорил (память) + граф людей (факты, связи, важность, когда упоминал). Read-only. Вызывай на «кто такой X», ' +
    '«телефон X», «напомни про X», «что я говорил про X».',
  category: 'memory',
  // TOOLFIX: алиасы имён аргументов модели → канон (см. _normalize-args).
  aliases: { person: 'name', personName: 'name', who: 'name', person_name: 'name' },
  schema: z.object({
    name: z.string().max(120),
  }),
  needsConfirm: false,
  sideEffects: 'read',
  examples: ['кто такой Серик', 'телефон Айгерим', 'напомни про брата'],
  handler: async (input, ctx) => {
    const userId = ctx.userId;
    const name = String(input.name || '').trim();
    if (!name) return { error: 'имя не указано' };
    const [contacts, mem, entities] = await Promise.all([
      prisma.contactCache.findMany({
        where: { userId, name: { contains: name, mode: 'insensitive' } },
        select: { name: true, phone: true, email: true, birthday: true },
        take: 3,
      }),
      getRelevantMemories(userId, name, 6),
      // Граф людей (Entity): раньше recall_person его не читал — факты и связи
      // («брат», «работает в Kaspi», «должен 20 000») мозг не находил по имени.
      prisma.entity
        .findMany({
          where: {
            userId,
            type: 'person',
            OR: [{ name: { contains: name, mode: 'insensitive' } }, { aliases: { has: name } }],
          },
          select: { id: true, name: true, attributes: true, importance: true, lastSeenAt: true },
          orderBy: { importance: 'desc' },
          take: 3,
        })
        .catch(() => []),
    ]);
    const relationships = entities.length
      ? await entityRelationshipLines(userId, entities.map((e) => e.id)).catch(() => [] as string[])
      : [];
    return {
      contacts: contacts.map((c) => ({
        name: c.name,
        phone: c.phone,
        email: c.email,
        birthday: c.birthday ? c.birthday.toISOString().slice(0, 10) : null,
      })),
      people: entities.map((e) => ({
        name: e.name,
        facts: entityFacts(e.attributes) || null,
        importance: e.importance,
        lastMentioned: e.lastSeenAt.toISOString().slice(0, 10),
      })),
      relationships,
      remembered: mem
        .filter(
          (m) =>
            m.type === 'person' ||
            m.content.toLowerCase().includes(name.toLowerCase()),
        )
        .map((m) => m.content),
    };
  },
});
