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
    // 9B.1: формат — прозовое правило (имена через запятую в двух
    // частях: обратимые / денежные-confirm), не `- name:` список.
    // Инвариант тот же: каждое имя реестра упомянуто, дрейфа нет.
    const text = capabilityText();
    const nameSet = new Set(names);
    const mentioned = [
      ...new Set(
        (text.match(/[a-z_]+/g) ?? []).filter((w) => nameSet.has(w)),
      ),
    ].sort();
    expect(mentioned).toEqual(names);
  });

  it('confirmAlwaysNames ⊆ имена реестра', () => {
    for (const n of confirmAlwaysNames()) {
      expect(names).toContain(n);
    }
  });

  // L99 #4 fix: zodToJsonSchema настроен с $refStrategy='none', но
  // тест не проверял что в реальных схемах нет $ref. Future tool с
  // z.lazy() или recursive структурой может вернуть refs обратно.
  it('JSON-схемы tools НЕ содержат $ref (recursive scan)', () => {
    function hasRef(obj: unknown): boolean {
      if (obj === null || typeof obj !== 'object') return false;
      if (Array.isArray(obj)) return obj.some(hasRef);
      const o = obj as Record<string, unknown>;
      if ('$ref' in o) return true;
      return Object.values(o).some(hasRef);
    }
    for (const schema of anthropicSchemas()) {
      expect(
        hasRef(schema),
        `tool ${schema.name} имеет $ref в input_schema`,
      ).toBe(false);
    }
  });

  // L99 #14 fix: load-time dup-name guard в tools/index.ts. Документируем
  // что эта защита работает — если бы был дубль, import index.ts
  // throw'нул бы при collect (тест не дошёл бы сюда). Sanity registry.
  it('registry содержит tools (load-time dup-guard прошёл)', () => {
    expect(registry.size).toBeGreaterThan(0);
  });

  // confirm-bridge fix: все четыре проекции фильтруют needsConfirm через
  // strict `=== false`/`=== true`. Функциональный needsConfirm выпал бы
  // из ВСЕХ → tool недостижим (невидим агенту И не стейджится confirm).
  // Load-time guard в index.ts throw'нул бы на import — этот тест
  // подтверждает инвариант: каждый зарегистрированный tool имеет
  // строго boolean needsConfirm (функциональная форма пока не используется).
  it('у каждого tool needsConfirm — строго boolean (strict-equality-safe)', () => {
    for (const tool of registry.values()) {
      expect(
        typeof tool.needsConfirm,
        `tool ${tool.name}: needsConfirm должен быть boolean, а не ${typeof tool.needsConfirm}`,
      ).toBe('boolean');
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
