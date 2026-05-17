import { describe, it, expect, vi } from 'vitest';
import { auditToolCall, type ToolCallRecord } from './tool-audit.js';

/**
 * SSOT Step 1 — инварианты слоя аудита. Чистая логика, без БД:
 * sink инъектируется. Это фундамент honesty-теста (Шаг 7):
 * число строк ToolCall === число реальных действий, не текст LLM.
 */

function recordingSink() {
  const rows: ToolCallRecord[] = [];
  return {
    rows,
    sink: async (r: ToolCallRecord) => {
      rows.push(r);
    },
  };
}

describe('auditToolCall — успех', () => {
  it('пишет РОВНО одну строку, error=null, возвращает результат', async () => {
    const { rows, sink } = recordingSink();
    const out = await auditToolCall(
      'u1',
      'create_task',
      { title: 'купить хлеб' },
      async () => ({ id: 't1' }),
      sink,
    );
    expect(out).toEqual({ id: 't1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'u1',
      toolName: 'create_task',
      inputJson: { title: 'купить хлеб' },
      outputJson: { id: 't1' },
      error: null,
    });
    expect(rows[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('auditToolCall — ошибка', () => {
  it('пишет одну строку с error и ПРОБРАСЫВАЕТ исходную ошибку', async () => {
    const { rows, sink } = recordingSink();
    const boom = new Error('DB down');
    await expect(
      auditToolCall('u1', 'add_expense', { amount: 5000 }, async () => {
        throw boom;
      }, sink),
    ).rejects.toThrow('DB down');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'u1',
      toolName: 'add_expense',
      inputJson: { amount: 5000 },
      outputJson: null,
      error: 'DB down',
    });
  });
});

describe('auditToolCall — сбой самого аудита не ломает действие', () => {
  it('успех: sink упал → результат всё равно возвращён, не брошено', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failingSink = async () => {
      throw new Error('audit write failed');
    };
    const out = await auditToolCall(
      'u1',
      'complete_habit',
      { name: 'бег' },
      async () => 'ok',
      failingSink,
    );
    expect(out).toBe('ok');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ошибка: sink упал → пробрасывается ИСХОДНАЯ ошибка хендлера, не аудита', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failingSink = async () => {
      throw new Error('audit write failed');
    };
    await expect(
      auditToolCall('u1', 'add_income', {}, async () => {
        throw new Error('handler real error');
      }, failingSink),
    ).rejects.toThrow('handler real error');
    warn.mockRestore();
  });
});
