import { describe, it, expect } from 'vitest';
import { runRegistryTool, ToolNotFoundError } from './index.js';
import type { ToolCallRecord } from '../services/tool-audit.js';

/**
 * Проверка #3 — runRegistryTool РЕАЛЬНО проходит через аудит, а не
 * «пишет в никуда». Без БД: sink инъектируется. get_today локально
 * упадёт на prisma (нет БД) — и это ОК: важно, что auditToolCall
 * всё равно зафиксировал РОВНО одну строку (error-row) с именем
 * tool. Значит middleware подключён; на деплое строка ляжет в
 * Postgres. End-to-end DB-запись проверяется smoke-тестом на деплое.
 */

function recordingSink() {
  const rows: ToolCallRecord[] = [];
  return { rows, sink: async (r: ToolCallRecord) => void rows.push(r) };
}

const ctx = { userId: 'u-dispatch-test' };

describe('runRegistryTool — аудит-обвязка подключена', () => {
  it('исполнение tool пишет РОВНО одну строку ToolCall (даже при падении хендлера)', async () => {
    const { rows, sink } = recordingSink();
    // get_today.handler дергает prisma.user — без БД бросит. Нам
    // важно: аудит зафиксировал попытку (одна строка, имя tool).
    await expect(
      runRegistryTool('get_today', {}, ctx, sink),
    ).rejects.toBeDefined();
    expect(rows).toHaveLength(1);
    expect(rows[0].toolName).toBe('get_today');
    expect(rows[0].userId).toBe('u-dispatch-test');
    expect(rows[0].error).toBeTruthy(); // ошибка зафиксирована, не проглочена
  });

  it('неизвестный tool → ToolNotFoundError, НИ одной строки аудита', async () => {
    const { rows, sink } = recordingSink();
    await expect(
      runRegistryTool('no_such_tool', {}, ctx, sink),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
    expect(rows).toHaveLength(0);
  });

  it('невалидный вход (zod) → отказ ДО аудита, строки нет', async () => {
    const { rows, sink } = recordingSink();
    await expect(
      // get_free_slots требует dateFrom/dateTo YYYY-MM-DD
      runRegistryTool('get_free_slots', { dateFrom: 'не дата' }, ctx, sink),
    ).rejects.toBeDefined();
    expect(rows).toHaveLength(0); // валидация не дошла до исполнения → не аудируем
  });
});
