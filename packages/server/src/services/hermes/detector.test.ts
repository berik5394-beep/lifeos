import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENG = readFileSync(
  join(process.cwd(), 'src/services/v2-proactivity-engine.ts'), 'utf-8');

describe('skill_suggestion detector', () => {
  it('adds skill_suggestion to NudgeSource', () => {
    expect(ENG).toMatch(/skill_suggestion/);
  });
  it('has a detectSkillOpportunity over ToolCall history', () => {
    expect(ENG).toMatch(/detectSkillOpportunity/);
    expect(ENG).toMatch(/toolCall\.findMany|toolCall\.groupBy/);
  });
  it('has a TEMPLATES entry for skill_suggestion', () => {
    expect(ENG).toMatch(/skill_suggestion:\s*\{/);
  });
  it('scoreSignificance handles skill_suggestion', () => {
    expect(ENG).toMatch(/case 'skill_suggestion'/);
  });
});
