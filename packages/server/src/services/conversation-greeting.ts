import type { AssistantContext, AssistantStyle } from '../ai/jarvis-prompt.js';
import type { GatheredContext } from './assistant-service.js';

/**
 * SSOT 9B.3 — детерминированное приветствие /voice/conversation/start.
 *
 * Раньше жило в conversation-engine.ts (1912 строк, удалён) вместе с
 * мёртвым processConversationMessage. Сам диалог давно идёт через
 * единый мозг (jarvis-orchestrator.handleMessage). Осталось только
 * короткое приветствие при первом старте сессии за день — оно
 * НАМЕРЕННО детерминированное (CLAUDE.md «утренний сценарий»: краткое
 * приветствие в стиле юзера + чипы-подсказки, потом ждём действие),
 * а не LLM-вызов: без лишней латентности/стоимости на каждый /start.
 * Работает на едином AssistantContext (тот же стиль/пол/контекст,
 * что и весь остальной мозг) — расхождение исключено by design.
 */

function timeGreeting(
  name: string,
  style: AssistantStyle,
  gender: string,
  totalTasks: number,
  pendingTasks: number,
  events: number,
  streak: number,
): string {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {
    const g: Record<'female' | 'male', Record<AssistantStyle, string>> = {
      female: {
        friendly: `Доброе утро, ${name}! Сегодня будет отличный день — я это чувствую! У тебя ${totalTasks} задач${events > 0 ? ` и ${events} встреч` : ''}.${streak > 1 ? ` Стрик: ${streak} дней!` : ''}`,
        strict: `Доброе утро. У тебя ${totalTasks} задач${events > 0 ? ` и ${events} встреч` : ''}. Не теряй время.`,
        calm: `Доброе утро, ${name}. Новый день — новая возможность.${totalTasks > 0 ? ` Сегодня ${totalTasks} задач.` : ''} Я рядом.`,
        toxic: `О, проснулся наконец? У тебя ${totalTasks} задач, и я сомневаюсь что ты всё сделаешь.${streak > 0 ? ` Стрик ${streak} дней — не испорти.` : ''}`,
      },
      male: {
        friendly: `Доброе утро, ${name}! Новый день — новый шанс стать лучше. ${totalTasks} задач${events > 0 ? `, ${events} встреч` : ''} — справимся!${streak > 1 ? ` Стрик: ${streak} дней!` : ''}`,
        strict: `Утро. Время работать. ${totalTasks} задач${events > 0 ? `, ${events} встреч` : ''}. Начинай.`,
        calm: `Доброе утро. День полон возможностей.${totalTasks > 0 ? ` ${totalTasks} задач ждут.` : ''} Спроси — и я помогу.`,
        toxic: `Проснулся, красавчик? У тебя ${totalTasks} дел и ${pendingTasks} ещё не сделаны. Может хотя бы сегодня попытаешься?`,
      },
    };
    return g[gender === 'male' ? 'male' : 'female'][style];
  }
  if (hour >= 12 && hour < 17) {
    return `Добрый день, ${name}!${pendingTasks > 0 ? ` Осталось ${pendingTasks} задач.` : ' Все задачи выполнены!'} Чем помочь?`;
  }
  if (hour >= 17 && hour < 22) {
    return `Добрый вечер, ${name}!${pendingTasks > 0 ? ` Ещё ${pendingTasks} задач не закрыты.` : ' Все задачи на сегодня выполнены!'} Как прошёл день?`;
  }
  return `Доброй ночи, ${name}. Поздновато, не пора ли отдохнуть?`;
}

function suggestionsFor(ctx: AssistantContext): string[] {
  const s: string[] = [];
  const hour = new Date().getHours();
  const pendingTasks = ctx.todayTasks.filter((t) => !t.completed).length;
  const pendingHabits =
    ctx.habitsProgress.total - ctx.habitsProgress.completed;

  if (hour >= 5 && hour < 12) {
    s.push('Какие планы на сегодня?');
    if (ctx.upcomingEvents.length > 0) s.push('Напомни о встречах');
    s.push('Как у меня с бюджетом?');
    s.push('Мотивируй меня!');
  } else if (hour >= 12 && hour < 18) {
    if (pendingTasks > 0) s.push('Что осталось сделать?');
    if (pendingHabits > 0) s.push('Отметь привычки');
    s.push('Сколько я потратил?');
  } else if (hour >= 18 && hour < 23) {
    s.push('Подведи итоги дня');
    s.push('Спокойной ночи');
    if (pendingHabits > 0) s.push('Закрой все привычки');
  } else {
    s.push('Спокойной ночи');
    s.push('Что запланировано на завтра?');
  }
  return s;
}

/**
 * Приветствие для /start. `null` если это НЕ первая сессия за день
 * (клиент тогда не показывает приветствие — поведение 1:1 с прежним
 * generateGreeting). Гейт первой сессии решает роут (DB-запрос там же,
 * где создаётся сессия).
 */
export function buildStartGreeting(
  gathered: GatheredContext,
  firstSessionToday: boolean,
): { text: string; suggestions: string[] } | null {
  if (!firstSessionToday) return null;
  const ctx: AssistantContext = gathered.context;
  const c = gathered.counts;
  const text = timeGreeting(
    ctx.userName,
    ctx.assistantStyle,
    ctx.assistantGender,
    c.tasksToday,
    c.tasksToday - c.tasksCompleted,
    ctx.upcomingEvents.length,
    c.currentStreak,
  );
  return { text, suggestions: suggestionsFor(ctx) };
}
