import { describe, it, expect } from 'vitest';
import { partitionToolUses } from './agent-tooluse.js';

const tu = (name: string, id = name) => ({ type: 'tool_use', name, id, input: { x: 1 } });

describe('partitionToolUses', () => {
  const exec = new Set(['create_task', 'get_tasks']);
  const confirm = new Set(['set_balance', 'clear_overdue']);

  it('делит на executable и confirmProposals, игнорит прочее', () => {
    const blocks = [
      { type: 'text', name: '', id: '', input: null },
      tu('create_task'),
      tu('set_balance'),
      tu('unknown_tool'),
    ];
    const r = partitionToolUses(blocks, exec, confirm);
    expect(r.executable.map((b) => b.name)).toEqual(['create_task']);
    expect(r.confirmProposals.map((b) => b.name)).toEqual(['set_balance']);
  });
  it('пустые наборы → всё игнор', () => {
    const r = partitionToolUses([tu('set_balance')], new Set(), new Set());
    expect(r.executable).toHaveLength(0);
    expect(r.confirmProposals).toHaveLength(0);
  });
  it('несколько confirm — все собираются (выбор первого — у вызывающего)', () => {
    const r = partitionToolUses([tu('set_balance'), tu('clear_overdue')], exec, confirm);
    expect(r.confirmProposals.map((b) => b.name)).toEqual(['set_balance', 'clear_overdue']);
  });
});
