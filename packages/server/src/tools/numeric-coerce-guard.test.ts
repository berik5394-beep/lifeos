import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { registry } from './index.js';

/**
 * ГАРД (урок set_birthday 2026-06-05): LLM регулярно шлёт числовые
 * аргументы инструментов СТРОКАМИ ({"day":"25"}). Голый z.number() их
 * отвергает → ZodError → инструмент молча падает в чате. Правило:
 * КАЖДОЕ числовое LLM-поле в tool-схеме должно быть z.coerce.number().
 *
 * Этот тест проходит по всем инструментам реестра, разворачивает
 * optional/default/nullable и падает, перечисляя поля с голым z.number().
 */

// Разворачиваем обёртки (optional/default/nullable) до базового типа.
function unwrap(t: unknown): unknown {
  let cur = t as { _def?: { innerType?: unknown } };
  while (cur && cur._def && cur._def.innerType) {
    cur = cur._def.innerType as { _def?: { innerType?: unknown } };
  }
  return cur;
}

describe('tool schemas: числовые поля должны coerce (LLM шлёт числа строками)', () => {
  it('ни одно числовое поле не использует голый z.number()', () => {
    const violations: string[] = [];
    for (const tool of registry.values()) {
      const schema = tool.schema as unknown;
      if (!(schema instanceof z.ZodObject)) continue;
      const shape = schema.shape as Record<string, unknown>;
      for (const [field, ztype] of Object.entries(shape)) {
        const base = unwrap(ztype) as { _def?: { coerce?: boolean } };
        if (base instanceof z.ZodNumber) {
          if (base._def?.coerce !== true) {
            violations.push(`${tool.name}.${field}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
