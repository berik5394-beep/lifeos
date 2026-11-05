import { describe, it, expect } from 'vitest';
import { EXPLAIN_PANELS, factsFallback } from './robot-explain.js';

describe('пояснение: сделки', () => {
  it('панель deals есть и пустая честно', () => {
    expect(EXPLAIN_PANELS).toContain('deals');
    expect(factsFallback('deals', [])).toBe('Сделок пока нет. Скажи «Ахмет хочет оборудование на 2 млн» — заведу.');
  });
});
