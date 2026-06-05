import { describe, it, expect } from 'vitest';
import {
  confirmToolSchemasForUser,
  confirmToolNamesForUser,
  agentToolNamesForUser,
} from './index.js';

// findMany(integration) для несуществующего юзера → [] (нужна тест-БД).
describe('confirm-проекции реестра', () => {
  it('confirmToolNamesForUser содержит needsConfirm:true и НЕ confirm-free', async () => {
    const names = await confirmToolNamesForUser('test-user-xyz');
    expect(names.has('set_balance')).toBe(true);
    expect(names.has('clear_overdue')).toBe(true);
    expect(names.has('create_task')).toBe(false);
  });
  it('исполняемый набор НЕ изменён — confirm-tools там отсутствуют', async () => {
    const exec = await agentToolNamesForUser('test-user-xyz');
    expect(exec.has('set_balance')).toBe(false);
    expect(exec.has('clear_overdue')).toBe(false);
    expect(exec.has('create_task')).toBe(true);
  });
  it('confirmToolSchemasForUser возвращает схемы с теми же именами', async () => {
    const schemas = await confirmToolSchemasForUser('test-user-xyz');
    const names = schemas.map((s) => s.name);
    expect(names).toContain('set_balance');
    expect(names).not.toContain('create_task');
  });
});
