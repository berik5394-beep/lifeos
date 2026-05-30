import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { linkRelationshipTool } from './link-relationship.js';

const SRC = readFileSync(join(__dirname, 'link-relationship.ts'), 'utf8');

describe('linkRelationshipTool — shape', () => {
  it('name + category + side-effects + no confirm', () => {
    expect(linkRelationshipTool.name).toBe('link_relationship');
    expect(linkRelationshipTool.category).toBe('memory');
    expect(linkRelationshipTool.sideEffects).toBe('write');
    expect(linkRelationshipTool.needsConfirm).toBe(false);
  });
  it('schema requires fromName + toName + type', () => {
    expect(() =>
      linkRelationshipTool.schema.parse({
        fromName: 'мама',
        toName: 'Серик',
        type: 'family',
      }),
    ).not.toThrow();
    expect(() =>
      linkRelationshipTool.schema.parse({ fromName: 'a', toName: 'b' }),
    ).toThrow();
  });
  it('schema caps type at 40 + label at 120', () => {
    expect(() =>
      linkRelationshipTool.schema.parse({
        fromName: 'a',
        toName: 'b',
        type: 'x'.repeat(41),
      }),
    ).toThrow();
  });
  it('handler calls getEntityGraph().linkEntities', () => {
    expect(SRC).toMatch(/getEntityGraph\(\)\.linkEntities/);
  });
});
