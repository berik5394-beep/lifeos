import { describe, it, expect } from 'vitest';
import { anthropicSchemas } from './index.js';

/**
 * REGRESSION GUARD (9A.8 incident, 2026-05-18).
 *
 * Anthropic tool input_schema MUST be JSON Schema draft 2020-12.
 * zodToJsonSchema({target:'openApi3'}) emitted draft-4/OpenAPI style
 * `"exclusiveMinimum": true` (boolean) for z.number().positive()/.min,
 * which is INVALID in 2020-12 → Anthropic 400 → agent loop dead in
 * prod (caught by ISSUE-1, reverted). Root cause: get_free_slots /
 * add_expense `.positive()`.
 *
 * This guard fails the build if ANY generated schema is not
 * 2020-12-safe: (a) boolean exclusiveMinimum/Maximum anywhere,
 * (b) a top-level $schema declaration (Anthropic validates as
 * 2020-12 regardless; a draft-07 $schema is noise/risk).
 * Deterministic, no API, runs always.
 */

function findBooleanExclusive(node: unknown, path = '$'): string[] {
  const hits: string[] = [];
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.exclusiveMinimum === 'boolean')
      hits.push(`${path}.exclusiveMinimum=boolean`);
    if (typeof o.exclusiveMaximum === 'boolean')
      hits.push(`${path}.exclusiveMaximum=boolean`);
    for (const [k, v] of Object.entries(o)) {
      hits.push(...findBooleanExclusive(v, `${path}.${k}`));
    }
  }
  return hits;
}

describe('Anthropic tool-schema compat (draft 2020-12)', () => {
  const schemas = anthropicSchemas();

  it('реестр непустой (sanity)', () => {
    expect(schemas.length).toBeGreaterThan(10);
  });

  it.each(schemas.map((s) => [s.name, s] as const))(
    '«%s» — НЕТ boolean exclusiveMinimum/Maximum (draft-4 мина)',
    (_name, s) => {
      expect(findBooleanExclusive(s.input_schema)).toEqual([]);
    },
  );

  it.each(schemas.map((s) => [s.name, s] as const))(
    '«%s» — НЕТ top-level $schema (Anthropic валидирует как 2020-12)',
    (_name, s) => {
      expect(
        (s.input_schema as Record<string, unknown>).$schema,
      ).toBeUndefined();
    },
  );

  it.each(schemas.map((s) => [s.name, s] as const))(
    '«%s» — корень это {type:object}',
    (_name, s) => {
      expect((s.input_schema as Record<string, unknown>).type).toBe('object');
    },
  );
});
