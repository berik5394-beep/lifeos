import { describe, it, expect, vi, afterEach } from 'vitest';
import { runRegistryTool, ToolNotFoundError } from './index.js';
import type { ToolCallRecord } from '../services/tool-audit.js';
import { prisma } from '../lib/prisma.js';

/**
 * Проверка #3 — runRegistryTool РЕАЛЬНО проходит через аудит, а не
 * «пишет в никуда». Без БД: sink инъектируется. Раньше тест полагался
 * на «prisma без DATABASE_URL бросит» — flaky между checkouts (на
 * main checkout DATABASE_URL мог быть установлен, и prisma не бросал
 * → resolved вместо rejected). Теперь — explicit mock через
 * vi.spyOn (scoped, не affects другие тесты). End-to-end DB-запись
 * проверяется smoke-тестом на деплое.
 */

function recordingSink() {
  const rows: ToolCallRecord[] = [];
  return { rows, sink: async (r: ToolCallRecord) => void rows.push(r) };
}

const ctx = { userId: 'u-dispatch-test' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runRegistryTool — аудит-обвязка подключена', () => {
  it('исполнение tool пишет РОВНО одну строку ToolCall (даже при падении хендлера)', async () => {
    const { rows, sink } = recordingSink();
    // Explicit mock: prisma.user.findUnique throws — гарантированно,
    // независимо от env (раньше полагались на отсутствие DATABASE_URL,
    // что flaky). get_today.handler первым делом дергает prisma.user.
    vi.spyOn(prisma.user, 'findUnique').mockRejectedValueOnce(
      new Error('mock: prisma DB unavailable for test'),
    );
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
