import type { ToolSideEffects } from '../tools/_types.js';
import { recordEvent } from './episodic-memory.js';
import { isV2MemoryEnabled } from '../lib/feature-flags.js';
import { STAGE_LABEL } from './deals/stages.js';

/**
 * ОДНА ПАМЯТЬ M1 — гибрид-захват, общий хелпер.
 *
 * `summarizeToolAction` — ЧИСТЫЙ маппер write-инструмента в лёгкое
 * эпизодическое событие (без сети/Prisma → юнит-тестируется, НИКОГДА
 * не бросает). `captureActivity` — общий fire-and-forget мост в v2
 * episodic, которым пользуются обе стороны гибрида: хук [A] в
 * runRegistryTool (chat/tool) и хуки [B] в mobile-роутах.
 *
 * Голос памяти единый: один словарь `type` для tool-хука и роутов.
 */

export type ActivitySummary = {
  type: string;
  content: string;
  importance?: number;
};

/** Безопасно достать строковое поле из неизвестного input/result. */
function str(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/** Безопасно достать числовое поле. */
function num(obj: unknown, key: string): number | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Инструмент НЕ сделал дело: ошибка, «не найдено», ok:false, выключен флагом.
 * Такое в память не пишем — раньше «закрой задачу X» без задачи X записывало
 * «Выполнил задачу «X»», и мозг «помнил» несделанное.
 */
export function isFailedResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  return (
    (typeof r.error === 'string' && r.error.length > 0) ||
    r.notFound === true ||
    r.ambiguous === true ||
    r.ok === false
  );
}

const DIRECTION: Record<string, string> = { i_owe: 'я должен', owed_to_me: 'мне должны' };
const money = (n: number | undefined) => (n === undefined ? '' : ` ${Math.round(n).toLocaleString('ru-RU').replace(/\u00a0/g, ' ')} ₸`);
const q = (v: string | undefined) => (v ? ` «${v}»` : '');

/**
 * Остальные write-инструменты (раньше в память попадали только 8 из 43 —
 * лимиты, цели, сделки, долги, решения, баланс мозг «не помнил»).
 * Инструменты графа людей (remember_entity/link_relationship/end_relationship)
 * пишут в память сами — здесь не дублируем.
 */
function summarizeOtherWrite(name: string, input: unknown, result: unknown): ActivitySummary | null {
  switch (name) {
    case 'cancel_task':
      return { type: 'task_cancelled', content: `Отменил задачу${q(str(input, 'title'))}` };
    case 'create_habit':
      return { type: 'habit_created', content: `Завёл привычку${q(str(input, 'name'))}` };
    case 'create_weekly_goal':
      return { type: 'weekly_goal_created', content: `Цель на неделю${q(str(input, 'goalText'))}` };
    case 'create_monthly_goal':
      return { type: 'monthly_goal_created', content: `Цель на месяц${q(str(input, 'goalText'))}` };
    case 'suggest_goal':
      return { type: 'yearly_goal_created', content: `Цель на год${q(str(input, 'goalText'))}`, importance: 6 };
    case 'decompose_goal':
      return { type: 'goal_decomposed', content: `Разложил цель на шаги${q(str(input, 'goal'))}` };
    case 'log_goal_progress':
    case 'update_goal_progress': {
      const pct = num(input, 'percent') ?? (input && (input as { valueIsPercent?: boolean }).valueIsPercent ? num(input, 'value') : undefined);
      const val = pct === undefined ? num(input, 'value') : undefined;
      return {
        type: 'goal_progress',
        content: `Прогресс цели${q(str(input, 'goalQuery'))}` + (pct !== undefined ? `: ${pct}%` : val !== undefined ? `: ${val}` : ''),
      };
    }
    case 'edit_expense':
      return { type: 'expense_edited', content: `Исправил расход${money(num(input, 'amount'))} → ${money(num(input, 'newAmount')).trim() || '?'}` };
    case 'delete_expense':
      return { type: 'expense_deleted', content: `Убрал расход${money(num(input, 'amount'))}${str(input, 'category') ? ` · ${str(input, 'category')}` : ''}` };
    case 'delete_income':
      return { type: 'income_deleted', content: `Убрал доход${money(num(input, 'amount'))}${str(input, 'source') ? ` · ${str(input, 'source')}` : ''}` };
    case 'set_budget':
      return { type: 'budget_set', content: `Лимит бюджета · ${str(input, 'category') ?? 'всего'}:${money(num(input, 'monthlyLimit'))}`, importance: 5 };
    case 'set_balance':
      return { type: 'balance_set', content: `Баланс на руках:${money(num(input, 'balance'))}`, importance: 6 };
    case 'create_deal':
      return {
        type: 'deal_created',
        content: `Сделка${q(str(input, 'title'))}${str(input, 'personName') ? ` с ${str(input, 'personName')}` : ''}${money(num(input, 'amount'))}`,
        importance: 6,
      };
    case 'update_deal':
      return {
        type: 'deal_updated',
        content: `Сделка${q(str(input, 'title') ?? str(input, 'personName'))}${str(input, 'stage') ? ` → «${(STAGE_LABEL as Record<string, string>)[str(input, 'stage') as string] ?? str(input, 'stage')}»` : ' обновлена'}`,
      };
    case 'set_sales_plan':
      return { type: 'sales_plan_set', content: `План продаж${str(input, 'month') ? ` на ${str(input, 'month')}` : ''}:${money(num(input, 'amount'))}`, importance: 5 };
    case 'create_obligation': {
      const who = str(input, 'personName') ?? 'кто-то';
      const dir = DIRECTION[str(input, 'direction') ?? ''] ?? 'долг';
      return { type: 'obligation_added', content: `Долг (${dir}): ${who}${money(num(input, 'amount'))}${str(input, 'dueDate') ? ` до ${str(input, 'dueDate')}` : ''}`, importance: 6 };
    }
    case 'settle_obligation': {
      const fin = result && typeof result === 'object' ? (result as { proposeFinance?: { who?: string; amount?: number } }).proposeFinance : undefined;
      return { type: 'obligation_settled', content: `Закрыл долг${fin?.who ? ` · ${fin.who}` : ''}${money(fin?.amount)}` };
    }
    case 'cancel_obligation':
      return { type: 'obligation_cancelled', content: 'Отменил долг' };
    case 'log_decision':
      return { type: 'decision_logged', content: `Решение${q(str(input, 'title'))}`, importance: 6 };
    case 'review_decision':
      return { type: 'decision_reviewed', content: `Итог решения${q(str(input, 'title'))}${str(input, 'verdict') ? `: ${str(input, 'verdict')}` : ''}` };
    case 'set_birthday':
      return { type: 'birthday_set', content: `День рождения${q(str(input, 'person'))}` };
    case 'set_person_type':
      return { type: 'person_type_set', content: `${str(input, 'person') ?? 'Человек'} — ${str(input, 'type') ?? 'тип'}` };
    case 'set_hour_rate':
      return { type: 'hour_rate_set', content: 'Цена часа обновлена' };
    case 'clear_overdue':
      return { type: 'overdue_cleared', content: 'Разгрёб просроченные задачи' };
    case 'defer_overdue':
      return { type: 'overdue_deferred', content: 'Перенёс просроченные задачи' };
    case 'apply_insight':
      return { type: 'insight_applied', content: 'Применил совет робота' };
    case 'create_skill':
      return { type: 'skill_created', content: `Новый навык${q(str(input, 'request'))}` };
    default:
      return null;
  }
}

/**
 * Чистый маппер: имя write-инструмента + распарсенный input + результат
 * → {type, content}. null когда:
 *   - sideEffects !== 'write' (read/external не захватываем);
 *   - имя неизвестно (не наш write-инструмент).
 * НИКОГДА не бросает — защитный доступ к полям, garbage → null или
 * безопасная строка.
 */
export function summarizeToolAction(
  name: string,
  input: unknown,
  result: unknown,
  sideEffects: ToolSideEffects,
): ActivitySummary | null {
  if (sideEffects !== 'write') return null;
  if (isFailedResult(result)) return null;

  try {
    switch (name) {
      case 'create_task': {
        const title = str(input, 'title') ?? 'без названия';
        const date = str(input, 'date');
        const priority = str(input, 'priority');
        return {
          type: 'task_created',
          content:
            `Создал задачу «${title}»` +
            (date ? ` на ${date}` : '') +
            (priority ? `, приоритет ${priority}` : ''),
        };
      }
      case 'complete_task': {
        const title = str(input, 'title') ?? str(input, 'taskId') ?? 'задачу';
        return {
          type: 'task_completed',
          content: `Выполнил задачу «${title}»`,
        };
      }
      case 'add_expense': {
        const amount = num(input, 'amount');
        const category = str(input, 'category') ?? 'other';
        const desc = str(input, 'description');
        return {
          type: 'expense_added',
          content:
            `Расход ${amount ?? '?'} ₸ · ${category}` +
            (desc ? ` · ${desc}` : ''),
        };
      }
      case 'add_income': {
        const amount = num(input, 'amount');
        const source = str(input, 'source');
        return {
          type: 'income_added',
          content: `Доход ${amount ?? '?'} ₸` + (source ? ` · ${source}` : ''),
        };
      }
      case 'complete_habit': {
        // «Сделал X» закрыл задачу (привычки X нет) — её запишет сам complete_task.
        if (result && typeof result === 'object' && (result as { completedTask?: unknown }).completedTask === true) {
          return null;
        }
        const habit = str(input, 'name') ?? str(input, 'habitId') ?? 'привычку';
        return {
          type: 'habit_logged',
          content: `Отметил привычку «${habit}»`,
        };
      }
      case 'complete_multiple_habits': {
        const raw =
          input && typeof input === 'object'
            ? (input as Record<string, unknown>).habitNames
            : undefined;
        // Ненайденные привычки не «отмечены» — в память только реально отмеченные.
        const notFoundRaw =
          result && typeof result === 'object'
            ? (result as Record<string, unknown>).notFoundNames
            : undefined;
        const missed = new Set(
          Array.isArray(notFoundRaw)
            ? notFoundRaw.filter((n): n is string => typeof n === 'string').map((n) => n.trim().toLowerCase())
            : [],
        );
        const list = Array.isArray(raw)
          ? raw
              .filter(
                (n): n is string => typeof n === 'string' && n.trim().length > 0,
              )
              .map((n) => n.trim())
              .filter((n) => !missed.has(n.toLowerCase()))
          : [];
        return {
          type: 'habit_logged',
          content: list.length
            ? `Отметил привычки: ${list.join(', ')}`
            : 'Отметил несколько привычек',
        };
      }
      case 'journal_entry': {
        const sleep = num(input, 'sleepHours');
        const energy = num(input, 'energy');
        const mood = num(input, 'mood');
        const parts: string[] = [];
        if (sleep !== undefined) parts.push(`сон ${sleep}ч`);
        if (energy !== undefined) parts.push(`энергия ${energy}`);
        if (mood !== undefined) parts.push(`настроение ${mood}`);
        return {
          type: 'journal_logged',
          content:
            'Дневник' +
            (parts.length ? `: ${parts.join(', ')}` : ' обновлён'),
        };
      }
      case 'create_event': {
        const title = str(input, 'title') ?? 'без названия';
        const date = str(input, 'date');
        const startTime = str(input, 'startTime');
        return {
          type: 'event_created',
          content:
            `Встреча «${title}»` +
            (date ? ` ${date}` : '') +
            (startTime ? ` в ${startTime}` : ''),
        };
      }
      default:
        return summarizeOtherWrite(name, input, result);
    }
  } catch {
    // Маппер НЕ должен ронять горячий путь tool-исполнения.
    return null;
  }
}

/**
 * Общий fire-and-forget мост в v2 episodic. Используется хуком [A]
 * (runRegistryTool) и хуками [B] (mobile-роуты).
 *   - summary === null → no-op (read/unknown/нечего захватывать);
 *   - флаг off → no-op (поведение байт-в-байт текущее);
 *   - иначе void recordEvent(...).catch(...) — НЕ await, НЕ блокирует.
 * Сбой захвата НИКОГДА не ломает действие/ответ юзеру.
 *
 * ОДНА ПАМЯТЬ M2: под флагом isV2WriteEnabled recordEvent делегирует в
 * writeMemory БЕЗ knob `embed` → shouldEmbed по типу даёт false для
 * высокочастотных action-событий (task_created/expense_added/…). Так
 * action-факты НЕ эмбедятся (FTS достаточно, embedding-бюджет цел), а
 * captureActivity остаётся тонким мостом — стоимость решает writeMemory.
 */
export function captureActivity(
  userId: string,
  summary: ActivitySummary | null,
): void {
  if (!summary) return;
  try {
    if (!isV2MemoryEnabled(userId)) return;
    void recordEvent(userId, {
      type: summary.type,
      content: summary.content,
      importance: summary.importance,
    }).catch((e) => console.warn('[capture] recordEvent failed', e));
  } catch (e) {
    // Хот-путь (хук [A] в runRegistryTool + хуки [B] в роутах): захват
    // НИКОГДА не должен ронять успешное действие/ответ юзеру. Любой
    // синхронный сбой (флаг-чек и т.п.) гасим здесь.
    console.warn('[capture] captureActivity failed', e);
  }
}
