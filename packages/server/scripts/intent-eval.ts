/**
 * Замер точности разбора намерений: Sonnet против Haiku на 30 фразах.
 * Запуск (нужен рабочий CLAUDE_API_KEY): npx tsx --env-file=.env scripts/intent-eval.ts
 * Детерминированный префильтр срабатывает одинаково для обеих моделей.
 */
import { parseIntent } from '../src/ai/intent-parser.js';
import { MODELS } from '../src/lib/models.js';

// Фразы из CLAUDE.md + типичные; ожидаемое действие LLM-шага.
const CASES: [string, string][] = [
  ['Создай задачу купить продукты на завтра', 'create_task'],
  ['Напомни позвонить врачу в пятницу в 10', 'create_task'],
  ['Закрой задачу подготовить отчёт', 'complete_task'],
  ['Отметь тренировку', 'complete_habit'],
  ['Я сделал медитацию и зарядку', 'complete_multiple_habits'],
  ['Сегодня прочитал 30 страниц', 'complete_habit'],
  ['Получил зарплату 350000', 'add_income'],
  ['Сколько я потратил в этом месяце?', 'get_finance'],
  ['Как у меня с бюджетом?', 'get_finance_advice'],
  ['Как мне сэкономить?', 'get_finance_advice'],
  ['Запиши встречу с Сериком завтра в 14:00', 'create_event'],
  ['Какие встречи на этой неделе?', 'ask_assistant'],
  ['Что у меня сегодня по расписанию?', 'ask_assistant'],
  ['Как я иду к годовой цели по финансам?', 'ask_assistant'],
  ['Мотивируй меня', 'ask_assistant'],
  ['Расскажи про инвестиции', 'ask_assistant'],
  ['Спокойной ночи', 'goodnight'],
  ['Доброе утро', 'good_morning'],
  ['Как дела на этой неделе', 'get_summary'],
  ['Подведи итоги дня', 'get_summary'],
  ['Найди билет в Москву на пятницу', 'plan_travel'],
  ['Полечу в Стамбул в субботу', 'plan_travel'],
  ['Купи продукты завтра', 'create_task'],
  ['Добавь задачу оплатить интернет до 20 числа, важно', 'create_task'],
  ['Встреча с поставщиком в понедельник в 11:30', 'create_event'],
  ['Что такое сложный процент', 'ask_assistant'],
  ['Отметь все привычки за сегодня', 'complete_multiple_habits'],
  ['Пробежал 5 км', 'complete_habit'],
  ['Поставь на завтра 3 задачи: отчёт, спортзал, звонок маме', 'create_task'],
  ['Сколько я заработал в октябре', 'get_finance'],
];

async function run(model: string) {
  let ok = 0;
  const miss: string[] = [];
  const t0 = Date.now();
  for (const [text, want] of CASES) {
    const r = await parseIntent(text, 'Asia/Almaty', new Date('2026-11-07T06:00:00Z'), { model });
    if (r.action === want) ok++;
    else miss.push(`${text} → ${r.action} (ждали ${want})`);
  }
  return { model, ok, total: CASES.length, ms: Math.round((Date.now() - t0) / CASES.length), miss };
}

(async () => {
  for (const m of [MODELS.sonnet, MODELS.haiku]) {
    const r = await run(m);
    console.log(`${r.model}: ${r.ok}/${r.total}, ~${r.ms} мс/фраза`);
    for (const x of r.miss) console.log('  ✗ ' + x);
  }
})();
