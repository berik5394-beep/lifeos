/**
 * Чистый делитель tool_use-блоков ответа агента на исполняемые
 * (needsConfirm:false, гоняются в цикле) и confirm-предложения
 * (needsConfirm:true, НЕ исполняются — стейджатся). Прочие имена игнор.
 * Без зависимостей — юнит-тестируется напрямую.
 */
export interface ToolUseLike {
  type: string;
  name: string;
  id: string;
  input: unknown;
}

export function partitionToolUses(
  blocks: ToolUseLike[],
  execNames: Set<string>,
  confirmNames: Set<string>,
): { executable: ToolUseLike[]; confirmProposals: ToolUseLike[] } {
  const executable: ToolUseLike[] = [];
  const confirmProposals: ToolUseLike[] = [];
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue;
    if (execNames.has(b.name)) executable.push(b);
    else if (confirmNames.has(b.name)) confirmProposals.push(b);
  }
  return { executable, confirmProposals };
}
