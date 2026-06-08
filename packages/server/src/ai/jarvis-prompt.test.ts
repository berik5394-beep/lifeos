import { describe, it, expect } from 'vitest';
import {
  buildJarvisPrompt,
  renderContext,
  getTimeOfDay,
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

describe('Слой честности B — анти-фабрикация (antiFab) + #5 overdue', () => {
  it('antiFab → пункт «ФАКТЫ — ТОЛЬКО ИЗ КОНТЕКСТА» в промпте', () => {
    expect(buildJarvisPrompt(ctx(), { antiFab: true })).toContain('ФАКТЫ — ТОЛЬКО ИЗ КОНТЕКСТА');
    expect(buildJarvisPrompt(ctx(), { antiFab: true })).toContain('НИКОГДА не выдумывай');
  });
  it('off (по умолчанию) → пункта нет (байт-идентично)', () => {
    expect(buildJarvisPrompt(ctx())).not.toContain('ФАКТЫ — ТОЛЬКО ИЗ КОНТЕКСТА');
  });
  it('#5: overduePending>0 → строка «Просрочено с прошлых дней: N»', () => {
    expect(renderContext(ctx({ overduePending: 7 }))).toContain('Просрочено с прошлых дней: 7');
  });
  it('#5: overduePending не задан → строки нет (off=байт-идентично)', () => {
    expect(renderContext(ctx())).not.toContain('Просрочено с прошлых');
  });
  it('#5: overduePending=0 → строки нет (честно, не «всё чисто» лишний раз)', () => {
    expect(renderContext(ctx({ overduePending: 0 }))).not.toContain('Просрочено с прошлых');
  });
});

describe('getTimeOfDay(tz) — время суток в поясе юзера', () => {
  const at = new Date('2026-06-06T14:00:00Z'); // 19:00 Алматы, 14:00 UTC
  it('БАГ-регресс: Алматы 19:00 → вечер (а не день по UTC сервера)', () => {
    expect(getTimeOfDay('Asia/Almaty', at)).toBe('вечер');
  });
  it('UTC тот же инстант → день (14:00)', () => {
    expect(getTimeOfDay('UTC', at)).toBe('день');
  });
});

describe('buildJarvisPrompt — блок СЕЙЧАС (realtime)', () => {
  const at = new Date('2026-06-06T14:42:00Z'); // 19:42 Алматы
  it('nowTz задан → промпт содержит СЕЙЧАС + локальное время + пояс', () => {
    const p = buildJarvisPrompt(ctx(), { nowTz: 'Asia/Almaty', _now: at });
    expect(p).toContain('СЕЙЧАС');
    expect(p).toMatch(/19:42/);
    expect(p).toContain('Asia/Almaty');
    expect(p).toContain('вечер');
  });
  it('nowTz НЕ задан → нет блока СЕЙЧАС (байт-идентично off)', () => {
    expect(buildJarvisPrompt(ctx())).not.toContain('СЕЙЧАС');
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
  it('meta#9: незакрытые привычки по имени + план недели в контексте', () => {
    const c = renderContext(
      ctx({
        pendingHabits: ['Йога', 'Чтение'],
        weeklyPlan: '1/3 — ✓ зал; ○ книга; ○ медитация',
      }),
    );
    expect(c).toContain('Сегодня НЕ отмечено: Йога, Чтение');
    expect(c).toContain('йога/духовное/чтение тоже считаются');
    expect(c).toContain('План на неделю: 1/3');
  });
  it('meta#9: пусто — секции опускаются', () => {
    const c = renderContext(ctx());
    expect(c).not.toContain('Сегодня НЕ отмечено');
    expect(c).not.toContain('План на неделю');
  });

  it('погода подмешивается только если задана (проактивно при событии)', () => {
    expect(renderContext(ctx())).not.toContain('Погода сегодня');
    const c = renderContext(ctx({ weatherToday: '22°C, ясно, ветер 3 км/ч' }));
    expect(c).toContain('Погода сегодня: 22°C, ясно');
    expect(c).toContain('одежде/времени выезда');
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

describe('ISSUE-4 — грамматика нулей + голосовая краткость', () => {
  it('правило про счётчики-нули всегда в промпте (text+voice)', () => {
    expect(buildJarvisPrompt(ctx())).toContain('Счётчики-нули');
  });
  it('channel:voice → блок ГОЛОСОВОЙ РЕЖИМ (краткость TTS)', () => {
    const p = buildJarvisPrompt(ctx(), { channel: 'voice' });
    expect(p).toContain('ГОЛОСОВОЙ РЕЖИМ');
    expect(p).toContain('открой приложение');
  });
  it('text/Telegram (без channel или text) — НЕТ голосового блока', () => {
    expect(buildJarvisPrompt(ctx())).not.toContain('ГОЛОСОВОЙ РЕЖИМ');
    expect(buildJarvisPrompt(ctx(), { channel: 'text' })).not.toContain(
      'ГОЛОСОВОЙ РЕЖИМ',
    );
  });
});
