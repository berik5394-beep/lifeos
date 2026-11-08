import { describe, it, expect } from 'vitest';
import { acceptsRecentOffer, mayNeedLocalTools } from './jarvis-orchestrator.js';

/**
 * Аудит 2026-11-08 (H1): «да» на предложение робота без pending шло к модели
 * БЕЗ инструментов → «привязал/закинул», ничего не сделав.
 */
const offer = (content: string) => [
  { role: 'user' as const, content: 'поставь цель прочитать 24 книги' },
  { role: 'assistant' as const, content },
];

describe('согласие на предложение робота → с инструментами', () => {
  const INTAKE = 'Цель записана…\n\nПод неё подходит твоя привычка «Чтение» — могу привязать.\nРазбить на шаги? Скажи «да».';
  const SLOT = '📚 Отстаёшь по «24 книги». В четверг (12.11) в 18:00 свободно ~120 мин — поставить занятие по цели? Скажи «да» — закину в план.';

  it('раньше «да» считалось болтовнёй (без инструментов) — это и был баг', () => {
    expect(mayNeedLocalTools('да')).toBe(false);
  });

  it.each(['да', 'Да!', 'давай', 'да, привяжи', 'ок, разбей', 'конечно', 'хорошо', 'поставь'])('«%s» после «Скажи «да»» → инструменты', (t) => {
    expect(acceptsRecentOffer(t, offer(INTAKE))).toBe(true);
    expect(acceptsRecentOffer(t, offer(SLOT))).toBe(true);
  });

  it('после вопроса робота («Разгрести вместе?») — тоже', () => {
    expect(acceptsRecentOffer('давай', offer('Накопилось 6 просрочек. Разгрести вместе?'))).toBe(true);
  });

  it('не согласие / длинная фраза / робот ничего не предлагал / пустая история → нет', () => {
    expect(acceptsRecentOffer('нет', offer(INTAKE))).toBe(false);
    expect(acceptsRecentOffer('дальше расскажи подробнее про то, как ты считаешь деньги и время', offer(INTAKE))).toBe(false);
    expect(acceptsRecentOffer('да', offer('Записал расход 3 000 ₸ на еду.'))).toBe(false);
    expect(acceptsRecentOffer('да', [])).toBe(false);
    expect(acceptsRecentOffer('даже не знаю', offer(INTAKE))).toBe(false);
  });
});
