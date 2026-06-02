import type { ToolSideEffects } from '../tools/_types.js';
import { recordEvent } from './episodic-memory.js';
import { isV2MemoryEnabled } from '../lib/feature-flags.js';

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
        const list = Array.isArray(raw)
          ? raw
              .filter(
                (n): n is string => typeof n === 'string' && n.trim().length > 0,
              )
              .map((n) => n.trim())
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
        return null;
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
