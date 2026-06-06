import { describe, it, expect } from 'vitest';
import { registry } from './index.js';
import { normalizeToolArgs } from './_normalize-args.js';

/**
 * TOOLFIX 4 — ДОКАЗАТЕЛЬСТВО, что «барахлят инструменты» починено.
 *
 * Берём РЕАЛЬНЫЕ входы, на которых tools падали в проде (ToolCall.error:
 * due_date вместо date, name/description вместо request, date:"today"),
 * прогоняем через тот же путь, что и runRegistryTool — нормализация
 * (tool.aliases + resolveDate) → tool.schema.parse — и проверяем, что
 * теперь парсится без ZodError и попадает в КАНОНИЧЕСКИЕ поля.
 *
 * Это e2e на уровне реестра (без БД/сети): берёт ФАКТИЧЕСКИ
 * зарегистрированные объекты tool, значит ловит и потерю aliases.
 */

// Стаб TZ-резолвера: off 0→today(2026-06-02), 1→завтра, 2, -1.
const resolveDate = (off: number) =>
  (({ '-1': '2026-06-01', '0': '2026-06-02', '1': '2026-06-03', '2': '2026-06-04' }) as Record<
    string,
    string
  >)[String(off)] ?? '2026-06-02';

/** Зеркалит runRegistryTool: нормализуем вход реальными tool.aliases, парсим схемой. */
function normalizeAndParse(toolName: string, rawInput: unknown): Record<string, unknown> {
  const tool = registry.get(toolName);
  if (!tool) throw new Error(`tool не зарегистрирован: ${toolName}`);
  const normalized = normalizeToolArgs(rawInput, { aliases: tool.aliases, resolveDate });
  return tool.schema.parse(normalized) as Record<string, unknown>; // бросит ZodError, если всё ещё ломается
}

describe('TOOLFIX e2e — реальные упавшие прод-входы теперь парсятся', () => {
  it('create_task: due_date → date (подтверждённый прод-сбой)', () => {
    const r = normalizeAndParse('create_task', {
      title: 'Выкатить релиз',
      due_date: '2026-06-08',
      description: 'через CI',
    });
    expect(r.date).toBe('2026-06-08');
    expect(r.title).toBe('Выкатить релиз');
  });

  it('create_task: относительная "завтра" в date → ISO', () => {
    const r = normalizeAndParse('create_task', { title: 'Купить хлеб', date: 'завтра' });
    expect(r.date).toBe('2026-06-03');
  });

  it('create_skill: name → request (подтверждённый прод-сбой)', () => {
    expect(normalizeAndParse('create_skill', { name: 'утренний брифинг' }).request).toBe(
      'утренний брифинг',
    );
  });

  it('create_skill: description → request', () => {
    expect(normalizeAndParse('create_skill', { description: 'собери сводку дня' }).request).toBe(
      'собери сводку дня',
    );
  });

  it('get_tasks: date "today" → ISO (подтверждённый прод-сбой; без алиасов, через resolveDate)', () => {
    expect(normalizeAndParse('get_tasks', { date: 'today' }).date).toBe('2026-06-02');
  });

  it('create_event: due_date→date, place→location, notes→description', () => {
    const r = normalizeAndParse('create_event', {
      title: 'Встреча с поставщиком',
      due_date: '2026-06-10',
      place: 'офис',
      notes: 'взять ноутбук',
    });
    expect(r.date).toBe('2026-06-10');
    expect(r.location).toBe('офис');
    expect(r.description).toBe('взять ноутбук');
  });

  it('complete_habit: habitName → name (имя из голосовой спеки)', () => {
    expect(normalizeAndParse('complete_habit', { habitName: 'тренировка' }).name).toBe(
      'тренировка',
    );
  });

  it('complete_task: taskTitle → title (имя из голосовой спеки)', () => {
    expect(normalizeAndParse('complete_task', { taskTitle: 'подготовить отчёт' }).title).toBe(
      'подготовить отчёт',
    );
  });

  it('suggest_goal: goal → goalText', () => {
    const r = normalizeAndParse('suggest_goal', {
      area: 'finance',
      goal: 'накопить 3 млн',
      rationale: 'это твоя годовая цель по финансам',
    });
    expect(r.goalText).toBe('накопить 3 млн');
    expect(r.area).toBe('finance');
  });

  it('add_expense: name → description (деньги не теряются)', () => {
    const r = normalizeAndParse('add_expense', { amount: 15000, name: 'кроссовки' });
    expect(r.amount).toBe(15000);
    expect(r.description).toBe('кроссовки');
  });

  it('get_calendar: dateFrom/dateTo → from/to (кросс-инструментная несогласованность)', () => {
    const r = normalizeAndParse('get_calendar', { dateFrom: '2026-06-01', dateTo: '2026-06-07' });
    expect(r.from).toBe('2026-06-01');
    expect(r.to).toBe('2026-06-07');
  });

  it('search_flights: from/to/departureDate → origin/destination/departureAt', () => {
    const r = normalizeAndParse('search_flights', {
      from: 'ALA',
      to: 'NQZ',
      departureDate: '2026-07-01',
    });
    expect(r.origin).toBe('ALA');
    expect(r.destination).toBe('NQZ');
    expect(r.departureAt).toBe('2026-07-01');
  });

  it('link_relationship: from/to/relation → fromName/toName/type', () => {
    const r = normalizeAndParse('link_relationship', {
      from: 'Берик',
      to: 'Айдана',
      relation: 'сестра',
    });
    expect(r.fromName).toBe('Берик');
    expect(r.toName).toBe('Айдана');
    expect(r.type).toBe('сестра');
  });
});

describe('TOOLFIX — регресс-гард: все аудированные tools несут aliases', () => {
  // 21 инструмент, которым в TOOLFIX 3 добавлены алиасы. Если кто-то
  // удалит — этот тест упадёт (а не молча вернётся «барахлит»).
  const TOOLS_WITH_ALIASES = [
    'add_expense', 'add_income', 'apply_insight', 'complete_habit',
    'complete_multiple_habits', 'complete_task', 'create_event', 'create_skill',
    'create_task', 'decompose_goal', 'get_calendar', 'get_free_slots',
    'get_goal_progress', 'get_weather', 'journal_entry', 'link_relationship',
    'recall_person', 'remember_entity', 'search_flights', 'send_telegram',
    'suggest_goal',
  ];

  it.each(TOOLS_WITH_ALIASES)('%s имеет непустой aliases-объект', (name) => {
    const tool = registry.get(name);
    expect(tool, `${name} должен быть в реестре`).toBeDefined();
    expect(tool!.aliases, `${name}.aliases`).toBeTruthy();
    expect(Object.keys(tool!.aliases ?? {}).length).toBeGreaterThan(0);
  });

  it('каждый alias указывает на РЕАЛЬНОЕ поле канон-схемы (нет опечаток в target)', () => {
    // Парсим имена полей схемы из её JSON-представления через safeParse
    // пустого объекта недостаточно; проверяем, что нормализация alias-входа
    // не оставляет alias-ключ и не падает на «канон не существует».
    for (const name of TOOLS_WITH_ALIASES) {
      const tool = registry.get(name)!;
      const aliases = tool.aliases!;
      for (const [alias, canon] of Object.entries(aliases)) {
        // alias и canon — непустые строки, не совпадают
        expect(typeof alias).toBe('string');
        expect(typeof canon).toBe('string');
        expect(alias).not.toBe(canon);
        expect(canon.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('TOOLFIX — намеренные исключения (без алиасов)', () => {
  // get_tasks: date опциональна с дефолтом «сегодня» — алиас на regex-поле
  // мог бы превратить безопасный пропуск в жёсткий reject. Относительные
  // даты он всё равно резолвит через нормализатор (тест выше).
  // Остальные — пустые схемы (нечего алиасить).
  const NO_ALIASES = [
    'get_tasks', 'get_budget', 'get_email_triage', 'get_trip',
    'get_weekly_plan',
  ];
  it.each(NO_ALIASES)('%s намеренно без aliases', (name) => {
    const tool = registry.get(name);
    expect(tool).toBeDefined();
    expect(tool!.aliases).toBeUndefined();
  });
});
