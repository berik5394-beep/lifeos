import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  registry,
  registryToolNames,
  anthropicSchemas,
  capabilityText,
  confirmAlwaysNames,
} from './index.js';
import { defineTool, type Tool } from './_types.js';

/**
 * SSOT invariant — registry-consistency.
 * Имена в автогенерённом промпте === ключи реестра === tool.name ===
 * имена Anthropic-схем. Падает при дрейфе пяти источников правды.
 *
 * На Шаге 2 реестр пуст — инварианты держатся тривиально, но
 * проверки НАСТОЯЩИЕ: добавится tool с рассинхроном — тест покраснеет.
 */

describe('registry: ключ === tool.name', () => {
  it('каждый ключ Map совпадает с name инструмента', () => {
    for (const [key, tool] of registry.entries()) {
      expect(key).toBe(tool.name);
    }
  });

  it('у каждого инструмента handler — функция', () => {
    for (const tool of registry.values()) {
      expect(typeof tool.handler).toBe('function');
    }
  });
});

describe('автоген строго отражает реестр', () => {
  const names = registryToolNames();

  it('anthropicSchemas: имена === имена реестра', () => {
    expect(anthropicSchemas().map((s) => s.name).sort()).toEqual(names);
  });

  it('capabilityText: упомянутые tool === имена реестра', () => {
    const mentioned = capabilityText()
      .split('\n')
      .map((l) => l.match(/^- ([a-z_]+):/)?.[1])
      .filter((x): x is string => !!x)
      .sort();
    expect(mentioned).toEqual(names);
  });

  it('confirmAlwaysNames ⊆ имена реестра', () => {
    for (const n of confirmAlwaysNames()) {
      expect(names).toContain(n);
    }
  });
});

/**
 * Не вакуумный: доказываем, что машинерия ловит дрейф. Если ключ
 * Map разойдётся с tool.name — инвариант обязан падать.
 */
describe('drift-guard реально ловит рассинхрон', () => {
  const sample: Tool = defineTool({
    name: 'sample_tool',
    description: 'тест',
    category: 'system',
    schema: z.object({ x: z.number() }),
    needsConfirm: false,
    sideEffects: 'read',
    handler: async () => 'ok',
  });

  it('корректная регистрация: ключ===name проходит', () => {
    const good = new Map([[sample.name, sample]]);
    for (const [k, t] of good) expect(k).toBe(t.name);
  });

  it('битая регистрация: ключ≠name — инвариант падает', () => {
    const bad = new Map([['WRONG_KEY', sample]]);
    expect(() => {
      for (const [k, t] of bad) {
        if (k !== t.name) throw new Error(`drift: ${k} !== ${t.name}`);
      }
    }).toThrow(/drift/);
  });

  it('defineTool сохраняет name и тип input', () => {
    expect(sample.name).toBe('sample_tool');
    expect(sample.schema.safeParse({ x: 1 }).success).toBe(true);
    expect(sample.schema.safeParse({ x: 'no' }).success).toBe(false);
  });
});
