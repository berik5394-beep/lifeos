import { describe, it, expect } from 'vitest';
import { pickIdentityUpdates } from './bot-identity.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('pickIdentityUpdates — pure helper', () => {
  it('passes through whitelisted keys', () => {
    expect(
      pickIdentityUpdates({ botName: 'Ария', avatar: '🌸', style: 'calm', traits: {} }),
    ).toEqual({ botName: 'Ария', avatar: '🌸', style: 'calm', traits: {} });
  });

  it('drops unknown keys', () => {
    expect(
      pickIdentityUpdates({
        botName: 'X',
        id: 'cuid_evil',
        userId: 'other_user',
        createdAt: new Date(),
      } as Record<string, unknown>),
    ).toEqual({ botName: 'X' });
  });

  it('drops undefined values', () => {
    expect(pickIdentityUpdates({ botName: undefined, avatar: '🧊' })).toEqual({
      avatar: '🧊',
    });
  });

  it('returns empty object for empty input', () => {
    expect(pickIdentityUpdates({})).toEqual({});
  });
});

const SRC = readFileSync(
  join(process.cwd(), 'src/services/bot-identity.ts'),
  'utf-8',
);

describe('bot-identity.ts structural', () => {
  it('exports IdentityService class', () => {
    expect(SRC).toMatch(/export class IdentityService/);
  });

  it('declares IdentityServiceStore interface', () => {
    expect(SRC).toMatch(/export interface IdentityServiceStore/);
  });

  it('re-exports BotIdentity type', () => {
    expect(SRC).toMatch(/export type \{[^}]*BotIdentity[^}]*\}/);
  });

  it('exports pickIdentityUpdates helper', () => {
    expect(SRC).toMatch(/export function pickIdentityUpdates/);
  });

  it('getIdentity uses prisma.botIdentity.upsert', () => {
    const start = SRC.indexOf('async getIdentity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    expect(body).toContain('prisma.botIdentity.upsert');
  });

  it('getIdentity create branch uses schema defaults', () => {
    const start = SRC.indexOf('async getIdentity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 1500);
    // empty create payload (schema provides defaults) OR explicit defaults
    expect(body).toMatch(/create: \{[\s\S]{0,400}\}/);
  });

  it('updateIdentity uses pickIdentityUpdates whitelist', () => {
    const start = SRC.indexOf('async updateIdentity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('pickIdentityUpdates(');
  });

  it('updateIdentity calls prisma.botIdentity.update', () => {
    const start = SRC.indexOf('async updateIdentity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('prisma.botIdentity.update');
  });

  it('updateIdentity syncs User.assistantStyle when style provided', () => {
    const start = SRC.indexOf('async updateIdentity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('prisma.user.update');
    expect(body).toContain('assistantStyle');
  });

  it('updateIdentity calls getIdentity first (ensures row exists)', () => {
    const start = SRC.indexOf('async updateIdentity');
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, start + 2000);
    expect(body).toContain('this.getIdentity(');
  });
});
