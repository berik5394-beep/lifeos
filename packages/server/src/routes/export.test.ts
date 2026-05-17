import { describe, it, expect } from 'vitest';
import { renderReportPdf, renderStorySvg } from './export.js';

/**
 * A.6 — экспорт стал реальными файлами (был JSON-обман). Регресс:
 * PDF — валидный бинарь, Story — валидный SVG с экранированием.
 */

describe('renderReportPdf', () => {
  it('возвращает валидный PDF-буфер (%PDF), непустой', async () => {
    const buf = await renderReportPdf({
      period: 'month',
      startDate: '2026-05-01',
      endDate: '2026-06-01',
      tasks: { total: 10, completed: 7, completionRate: 70 },
      habits: { activeCount: 4, totalCompletions: 88 },
      finance: {
        totalExpenses: 120000,
        totalIncomes: 350000,
        balance: 230000,
        topCategories: [{ category: 'food', amount: 50000 }],
      },
    });
    expect(buf.length).toBeGreaterThan(800);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('renderStorySvg', () => {
  it('валидный SVG нужного размера со статами', () => {
    const svg = renderStorySvg('Мой прогресс', [
      { label: 'Задачи', value: '7/10' },
      { label: 'Серия', value: '5 дн' },
    ]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="1080" height="1920"');
    expect(svg).toContain('Мой прогресс');
    expect(svg).toContain('7/10');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });
  it('экранирует спецсимволы (нет инъекции разметки)', () => {
    const svg = renderStorySvg('A & <b>', [{ label: '<x>', value: '&' }]);
    expect(svg).toContain('A &amp; &lt;b&gt;');
    expect(svg).not.toContain('<b>');
  });
});
