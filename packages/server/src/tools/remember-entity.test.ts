import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rememberEntityTool } from './remember-entity.js';

const SRC = readFileSync(join(__dirname, 'remember-entity.ts'), 'utf8');

describe('rememberEntityTool — shape', () => {
  it('name = remember_entity, category memory, write, no confirm', () => {
    expect(rememberEntityTool.name).toBe('remember_entity');
    expect(rememberEntityTool.category).toBe('memory');
    expect(rememberEntityTool.sideEffects).toBe('write');
    expect(rememberEntityTool.needsConfirm).toBe(false);
  });
  it('schema accepts valid input', () => {
    expect(() =>
      rememberEntityTool.schema.parse({
        type: 'person',
        name: 'мама',
        importance: 9,
      }),
    ).not.toThrow();
  });
  it('schema rejects unknown type', () => {
    expect(() =>
      rememberEntityTool.schema.parse({ type: 'animal', name: 'x' }),
    ).toThrow();
  });
  it('schema rejects importance out of [1,10]', () => {
    expect(() =>
      rememberEntityTool.schema.parse({
        type: 'person',
        name: 'a',
        importance: 11,
      }),
    ).toThrow();
  });
  it('handler delegates to getEntityGraph().upsertEntity', () => {
    expect(SRC).toMatch(/getEntityGraph\(\)\.upsertEntity/);
  });
});
