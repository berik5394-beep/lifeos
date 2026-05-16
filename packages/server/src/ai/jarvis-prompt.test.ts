import { describe, it, expect } from 'vitest';
import {
  buildJarvisPrompt,
  renderContext,
  type AssistantContext,
} from './jarvis-prompt.js';

/**
 * Единый промт-«дирижёр» — теперь ЕДИНСТВЕННЫЙ источник правды для
 * оркестратора и fallback. Покрываем регрессом: формат-правила,
 * выбор ровно одного стиля, пропуск пустых секций, ритуалы.
 */

function ctx(over: Partial<AssistantContext> = {}): AssistantContext {
  return {
    userName: 'Берик',
    assistantStyle: 'friendly',
    assistantGender: 'male',
    todayTasks: [],
    habitsProgress: { total: 0, completed: 0 },
    upcomingEvents: [],
    spentThisMonth: 0,
    budgetLimit: 0,
    currentStreak: 0,
    weekProgress: 0,
    yearlyGoalsSummary: 'Не заданы',
    ...over,
  };
}

describe('buildJarvisPrompt — ЯДРО и формат', () => {
  it('содержит имя, запрет markdown и фокус на последнем сообщении', () => {
    const p = buildJarvisPrompt(ctx());
    expect(p).toContain('Берик');
    expect(p).toContain('Markdown НЕ поддерживается');
    expect(p).toContain('ФОКУС');
    expect(p).toContain('ПОИСК В ИНТЕРНЕТЕ');
  });
});

describe('buildJarvisPrompt — ровно один стиль', () => {
  it('friendly → дружелюбный блок, без других', () => {
    const p = buildJarvisPrompt(ctx({ assistantStyle: 'friendly' }));
    expect(p).toContain('дружелюбный помощник и поддерживающий друг');
    expect(p).not.toContain('строгий наставник и требовательный коуч');
    expect(p).not.toContain('мотиватор-буллер');
  });
  it('toxic → токсичный блок c safety-оговоркой', () => {
    const p = buildJarvisPrompt(ctx({ assistantStyle: 'toxic' }));
    expect(p).toContain('мотиватор-буллер');
    expect(p).toContain('СБРОСЬ токсичность');
  });
  it('strict / calm выбираются корректно', () => {
    expect(buildJarvisPrompt(ctx({ assistantStyle: 'strict' }))).toContain(
      'строгий наставник и требовательный коуч',
    );
    expect(buildJarvisPrompt(ctx({ assistantStyle: 'calm' }))).toContain(
      'дзен-учитель',
    );
  });
  it('некорректный стиль → fallback friendly (не падает)', () => {
    const p = buildJarvisPrompt(
      ctx({ assistantStyle: 'wat' as unknown as AssistantContext['assistantStyle'] }),
    );
    expect(p).toContain('дружелюбный помощник');
  });
});

describe('renderContext — пустые секции опускаются', () => {
  it('нет данных → нет секций задач/привычек/финансов', () => {
    const c = renderContext(ctx());
    expect(c).not.toContain('Задачи на сегодня');
    expect(c).not.toContain('Привычки:');
    expect(c).not.toContain('Финансы:');
    expect(c).toContain('Имя: Берик');
  });
  it('есть данные → секции присутствуют', () => {
    const c = renderContext(
      ctx({
        todayTasks: [{ title: 'Отчёт', completed: false }],
        habitsProgress: { total: 3, completed: 1 },
        currentStreak: 5,
        budgetLimit: 100000,
        spentThisMonth: 80000,
      }),
    );
    expect(c).toContain('Задачи на сегодня: выполнено 0 из 1');
    expect(c).toContain('Невыполненные: Отчёт');
    expect(c).toContain('Привычки: 1 из 3');
    expect(c).toContain('Серия: 5 дней');
    expect(c).toContain('80%');
  });
  it('память (top-15) попадает в контекст', () => {
    const c = renderContext(
      ctx({ memories: [{ type: 'person', content: 'Серик — брат', importance: 8 }] }),
    );
    expect(c).toContain('Что ты помнишь о пользователе');
    expect(c).toContain('Серик — брат');
  });
});

describe('buildJarvisPrompt — ритуалы', () => {
  it('morning → РИТУАЛ УТРА', () => {
    expect(buildJarvisPrompt(ctx(), { ritual: 'morning' })).toContain(
      'РИТУАЛ УТРА',
    );
  });
  it('night → РИТУАЛ НОЧИ с процентом', () => {
    const p = buildJarvisPrompt(ctx(), {
      ritual: 'night',
      dayCompletionPercent: 73,
    });
    expect(p).toContain('РИТУАЛ НОЧИ');
    expect(p).toContain('73%');
  });
  it('без ритуала — нет ритуальных блоков', () => {
    const p = buildJarvisPrompt(ctx());
    expect(p).not.toContain('РИТУАЛ УТРА');
    expect(p).not.toContain('РИТУАЛ НОЧИ');
  });
});
