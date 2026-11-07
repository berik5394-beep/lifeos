import { describe, it, expect, vi } from 'vitest';

const create = vi.fn();
vi.mock('../lib/anthropic.js', () => ({
  createAnthropic: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }),
  QUICK_CALL: { timeout: 8000, maxRetries: 1 },
}));
const { extractEntities } = await import('./entity-extractor.js');

const reply = (json: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(json) }] });

describe('извлечение: «изменилось» о человеке', () => {
  it('«мама переехала в Астану» → changed: ["город"]', async () => {
    create.mockResolvedValueOnce(
      reply({ entities: [{ name: 'мама', type: 'person', attributes: { город: 'Астана' }, changed: ['город'] }], relationships: [] }),
    );
    const r = await extractEntities('мама переехала в Астану', 'u');
    expect(r.entities[0]).toMatchObject({ name: 'Мама', attributes: { город: 'Астана' }, changed: ['город'] });
  });
  it('changed без такого ключа в attributes / мусор — отбрасывается', async () => {
    create.mockResolvedValueOnce(
      reply({ entities: [{ name: 'Серик', type: 'person', attributes: { работа: 'Kaspi' }, changed: ['город', 5] }], relationships: [] }),
    );
    const r = await extractEntities('Серик работает в Kaspi', 'u');
    expect(r.entities[0].changed).toBeUndefined();
  });
  it('промпт объясняет, когда ставить changed (только прямое «изменилось»)', async () => {
    create.mockResolvedValueOnce(reply({ entities: [], relationships: [] }));
    await extractEntities('привет', 'u');
    const system = String((create.mock.calls.at(-1)?.[0] as { system: string }).system);
    expect(system).toMatch(/changed — ТОЛЬКО если пользователь прямо говорит/);
  });
});
