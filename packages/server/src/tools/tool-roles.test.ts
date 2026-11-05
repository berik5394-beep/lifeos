import { describe, it, expect } from 'vitest';
import { registry, agentToolSchemas } from './index.js';
import { deterministicIntent } from '../ai/intent-parser.js';
import { MODELS } from '../lib/models.js';
import { createAnthropic } from '../lib/anthropic.js';
import { matchTaskByWholeWords } from '../services/task-title.js';
import { summarizeToolAction } from '../services/tool-activity-summary.js';

/**
 * «Каждый инструмент с каждым, без пересечений интересов» (спека перегруза,
 * часть D). Пары, между которыми модель может выбрать не тот на одну фразу:
 * каждый в описании явно говорит «это не я, а …». Тест держит это от дрейфа.
 */
const PAIRS: Array<[string, string]> = [
  ['create_task', 'create_event'],
  ['create_event', 'create_task'],
  ['complete_task', 'complete_habit'],
  ['complete_habit', 'complete_task'],
  ['create_task', 'create_obligation'],
  ['create_obligation', 'create_task'],
  ['remember_entity', 'set_birthday'],
  ['set_birthday', 'remember_entity'],
  ['suggest_goal', 'create_monthly_goal'],
  ['create_monthly_goal', 'suggest_goal'],
  ['update_deal', 'create_obligation'],
  ['create_obligation', 'update_deal'],
  ['update_deal', 'create_task'],
  ['create_task', 'update_deal'],
  ['update_deal', 'add_income'],
];

describe('роли инструментов: каждый знает соседа по смыслу', () => {
  it.each(PAIRS)('%s → отсылает к %s', (tool, other) => {
    const t = registry.get(tool);
    expect(t, `${tool} в реестре`).toBeDefined();
    expect(t!.description).toContain(other);
  });
});

/** Детерминированный слой (без ИИ): частые фразы идут ровно в свой инструмент. */
const DETERMINISTIC: Array<[string, string]> = [
  ['Создай задачу купить хлеб завтра', 'create_task'],
  ['Напомни позвонить в банк', 'create_task'],
  ['Закрой задачу отчёт', 'complete_task'],
  ['Сделал зарядку', 'complete_habit'],
  ['Отметь бег и чтение', 'complete_multiple_habits'],
];

describe('строгий матч «сделал X» → задача и честная память', () => {
  const tasks = [{ title: 'Купить йогурт' }, { title: 'Квартальный отчёт' }, { title: 'Отчёт для банка' }];
  it('целые слова, ровно одна задача', () => {
    expect(matchTaskByWholeWords('квартальный отчёт', tasks)?.title).toBe('Квартальный отчёт');
    expect(matchTaskByWholeWords('йогу', tasks)).toBeNull();
    expect(matchTaskByWholeWords('отчёт', tasks)).toBeNull(); // две — не гадаем
  });
  it('complete_habit, закрывший задачу, не пишет в память «Отметил привычку»', () => {
    expect(summarizeToolAction('complete_habit', { name: 'отчёт' }, { completedTask: true }, 'write')).toBeNull();
    expect(summarizeToolAction('complete_habit', { name: 'бег' }, { message: 'ok' }, 'write')?.content).toBe('Отметил привычку «бег»');
  });
});

describe('маршрутизация без ИИ', () => {
  it.each(DETERMINISTIC)('«%s» → %s', (text, action) => {
    expect(deterministicIntent(text, 'Asia/Almaty', new Date('2026-11-05T06:00:00Z'))?.action).toBe(action);
  });
});

/**
 * Живой eval на реальной модели (как агент-цикл видит инструменты). Платный —
 * только по запросу: RUN_TOOL_ROUTING_EVAL=1 + CLAUDE_API_KEY.
 */
const LIVE: Array<[string, string]> = [
  ['Запиши встречу с Сериком завтра с 14:00 до 15:00 в кафе Deli', 'create_event'],
  ['Надо завтра забрать посылку с почты', 'create_task'],
  ['Я обещал Асель прислать презентацию до пятницы', 'create_obligation'],
  ['Запомни, у Ахмета день рождения 12 мая', 'set_birthday'],
  ['Моя цель на этот месяц — закрыть 3 сделки', 'create_monthly_goal'],
  ['Хочу накопить 100000 к концу месяца', 'suggest_goal'],
  ['Хочу к концу года прочитать 50 книг', 'suggest_goal'],
];

describe.skipIf(process.env.RUN_TOOL_ROUTING_EVAL !== '1' || !process.env.CLAUDE_API_KEY)('живой eval маршрутизации', () => {
  const client = createAnthropic(process.env.CLAUDE_API_KEY);
  const tools = agentToolSchemas() as Parameters<typeof client.messages.create>[0]['tools'];

  it.each(LIVE)('«%s» → %s', async (text, expected) => {
    const res = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 400,
      system: `Ты LifeOS. Сегодня 2026-11-05. Выполни просьбу пользователя ОДНИМ инструментом.`,
      tools,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: text }],
    });
    const used = res.content.find((b) => b.type === 'tool_use');
    expect(used && 'name' in used ? used.name : null).toBe(expected);
  }, 60_000);
});
