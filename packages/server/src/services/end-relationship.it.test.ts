import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getEntityGraph } from './entity-graph/index.js';
import { endRelationshipTool } from '../tools/end-relationship.js';

const prisma = new PrismaClient();
const PREV = process.env.FEATURE_V2_UNLINK;
afterAll(async () => { if (PREV === undefined) delete process.env.FEATURE_V2_UNLINK; else process.env.FEATURE_V2_UNLINK = PREV; await prisma.$disconnect(); });
async function mkUser(tag: string): Promise<string> {
  const u = await prisma.user.create({ data: { email: `it-unlink-${tag}@it.local`, name: 'IT', passwordHash: 'x', timezone: 'Asia/Almaty' } });
  return u.id;
}

describe('F2-links — graph primitives', () => {
  it('invalidateLink ретайрит активную; activeLinksForEntity её больше не отдаёт', async () => {
    const uid = await mkUser(`g-${Date.now()}`);
    const g = getEntityGraph();
    const me = await g.upsertEntity(uid, { type: 'person', name: 'Я' });
    const serik = await g.upsertEntity(uid, { type: 'person', name: 'Серик' });
    await g.linkEntities(uid, me.id, serik.id, 'colleague');
    let links = await g.activeLinksForEntity(uid, serik.id);
    expect(links.length).toBe(1);
    await g.invalidateLink(uid, links[0].id);
    const row = await prisma.entityRelationship.findUnique({ where: { id: links[0].id } });
    expect(row!.invalidAt).not.toBeNull();
    links = await g.activeLinksForEntity(uid, serik.id);
    expect(links.length).toBe(0);
  });
  it('cross-user: invalidateLink чужим userId не трогает', async () => {
    const uid = await mkUser(`x-${Date.now()}`);
    const g = getEntityGraph();
    const a = await g.upsertEntity(uid, { type: 'person', name: 'A' });
    const b = await g.upsertEntity(uid, { type: 'person', name: 'B' });
    const link = await g.linkEntities(uid, a.id, b.id, 'friend');
    await g.invalidateLink('someone-else-xyz', link.id);
    const row = await prisma.entityRelationship.findUnique({ where: { id: link.id } });
    expect(row!.invalidAt).toBeNull();
  });
});

describe('F2-links — end_relationship tool', () => {
  it('off → {error}, связь не трогается', async () => {
    process.env.FEATURE_V2_UNLINK = 'none';
    const uid = await mkUser(`off-${Date.now()}`);
    const g = getEntityGraph();
    const me = await g.upsertEntity(uid, { type: 'person', name: 'Я' });
    const x = await g.upsertEntity(uid, { type: 'person', name: 'Серик' });
    const link = await g.linkEntities(uid, me.id, x.id, 'colleague');
    const res = await endRelationshipTool.handler({ name: 'Серик' }, { userId: uid } as never);
    expect((res as { error?: string }).error).toBeDefined();
    const row = await prisma.entityRelationship.findUnique({ where: { id: link.id } });
    expect(row!.invalidAt).toBeNull();
  });
  it('on + единственная связь → инвалидирует', async () => {
    process.env.FEATURE_V2_UNLINK = 'all';
    const uid = await mkUser(`on-${Date.now()}`);
    const g = getEntityGraph();
    const me = await g.upsertEntity(uid, { type: 'person', name: 'Я' });
    const x = await g.upsertEntity(uid, { type: 'person', name: 'Серик' });
    const link = await g.linkEntities(uid, me.id, x.id, 'colleague');
    const res = await endRelationshipTool.handler({ name: 'Серик' }, { userId: uid } as never);
    expect((res as { ended?: boolean }).ended).toBe(true);
    const row = await prisma.entityRelationship.findUnique({ where: { id: link.id } });
    expect(row!.invalidAt).not.toBeNull();
  });
  it('on + >1 связь → скип (обе живы)', async () => {
    process.env.FEATURE_V2_UNLINK = 'all';
    const uid = await mkUser(`amb-${Date.now()}`);
    const g = getEntityGraph();
    const me = await g.upsertEntity(uid, { type: 'person', name: 'Я' });
    const x = await g.upsertEntity(uid, { type: 'person', name: 'Серик' });
    const l1 = await g.linkEntities(uid, me.id, x.id, 'colleague');
    const l2 = await g.linkEntities(uid, me.id, x.id, 'friend');
    const res = await endRelationshipTool.handler({ name: 'Серик' }, { userId: uid } as never);
    expect((res as { ended?: boolean }).ended).toBeUndefined();
    const r1 = await prisma.entityRelationship.findUnique({ where: { id: l1.id } });
    const r2 = await prisma.entityRelationship.findUnique({ where: { id: l2.id } });
    expect(r1!.invalidAt).toBeNull(); expect(r2!.invalidAt).toBeNull();
  });
});
