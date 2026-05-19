/**
 * Phase 5 P2 — planner-service: декомпозиция цели в дерево
 * год → (квартал/milestone) → неделя → привычка/задача.
 *
 * Архитектура (как intent-parser/capture-gate): ДЕТЕРМИНИРОВАННЫЙ
 * классификатор решает «разбивать ли и как» (тестируемо, без LLM),
 * Claude генерирует САМО дерево только когда decompose/partial
 * (шаг 3b). Conservative bias: спорное → keep_atomic (лучше не
 * наплодить мусор, чем разбить разовую встречу).
 *
 * north star: декомпозиция ОБЯЗАНА дойти до дневного действия
 * (Habit/Task), не остановиться на «красивых кварталах».
 */

/**
 * - decompose   — повторяемая/измеримая цель (обучение, навык,
 *                  привычка, финансы-накопление, здоровье) →
 *                  год→неделя→привычка/задача.
 * - partial     — проект с дедлайном → milestones (НЕ по дням).
 * - keep_atomic — разовое (встреча, ДР, покупка, звонок) — НЕ
 *                  разбивается. Дефолт для спорного.
 */
export type GoalDecision = 'decompose' | 'partial' | 'keep_atomic';

/**
 * Детерминированное решение по тексту цели. Порядок проверок:
 * PARTIAL (проект+дедлайн) → DECOMPOSE (жизненная измеримая цель)
 * → KEEP_ATOMIC (разовое) → дефолт keep_atomic.
 */
// Проект-глаголы (нужен И дедлайн → partial: milestones, не дни).
const PARTIAL_PROJECT =
  /(проект|запуст|запуск|релиз|mvp|диплом|организ(?:ова|уй|ация)|защит)/i;
// ВАЖНО: \b НЕ работает с кириллицей в JS-regex (конвенция проекта —
// границы через (?:^|\s)/корни, не \b).
const PARTIAL_DEADLINE =
  /(дедлайн|срок|(?:^|\s)к \d|(?:^|\s)до \d|(?:^|\s)к (?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|лет|осен|зим|весн|концу)|(?:^|\s)до (?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр))/i;

// Жизненная измеримая/повторяемая цель → разбивается до дневного
// действия (обучение/навык/финансы-накопление/здоровье/привычка).
const DECOMPOSE =
  /(книг|прочита|чита(?:ть|ю)|страниц|выучи|изучи|научи|освои|язык|английск|испанск|немецк|француз|курс|накопи|сэконом|накоплен|млн|миллион|похуд|сброси|набра|кг|бега|пробеж|трениров|спорт|медитац|форм[уы]|здоров|подтяну|подтягив|каждый день|раз[а]? в недел|в день по|зарабат)/i;

import Anthropic from '@anthropic-ai/sdk';
import { AiModelError } from '../lib/errors.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

/** Узел недельного уровня (→ WeeklyGoal на шаге 3c). */
export interface PlanWeek {
  text: string;
  /** Опц. числовой ориентир недели (≈1 книга, ≈8 км). */
  metric?: string;
}
/** Кастомный milestone (pacingPlan JSON, неравномерная кривая). */
export interface PlanMilestone {
  label: string; // «Q1», «Месяц 1», «−3 кг»
  target?: number;
  by?: string; // YYYY-MM-DD
}
/**
 * Результат генерации дерева. weeks[] + habit = дойти до ДНЕВНОГО
 * действия (north star). pacingMode:uniform → milestones=null
 * (квартал считается на лету). custom → milestones[] в pacingPlan.
 */
export interface PlanTree {
  pacingMode: 'uniform' | 'custom';
  target: number | null;
  weeks: PlanWeek[];
  habit: { name: string; frequency: 'daily' | 'weekly' } | null;
  milestones: PlanMilestone[] | null;
  rationale: string;
  spokenResponse: string;
}

/**
 * Чистый разбор ответа Claude в PlanTree. Тестируется БЕЗ сети.
 * Мусор/пусто/битый JSON → null (честный отказ выше по стеку, НЕ
 * выдуманное дерево — класс bug #1). Не бросает.
 */
export function parsePlanTree(raw: string): PlanTree | null {
  if (!raw || typeof raw !== 'string') return null;
  let t = raw.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const pacingMode = o.pacingMode === 'custom' ? 'custom' : 'uniform';
  const weeksRaw = Array.isArray(o.weeks) ? o.weeks : [];
  const weeks: PlanWeek[] = weeksRaw
    .map((w): PlanWeek | null => {
      const obj = w as Record<string, unknown>;
      const text = typeof obj?.text === 'string' ? obj.text.trim() : '';
      if (!text) return null;
      return {
        text: text.slice(0, 300),
        metric:
          typeof obj.metric === 'string'
            ? obj.metric.slice(0, 80)
            : undefined,
      };
    })
    .filter((w): w is PlanWeek => w !== null)
    .slice(0, 8);
  // Нечего разбивать → null (caller честно скажет «не из чего»).
  if (weeks.length === 0) return null;
  const h = o.habit as Record<string, unknown> | null | undefined;
  const habit =
    h && typeof h.name === 'string' && h.name.trim()
      ? {
          name: h.name.trim().slice(0, 200),
          frequency: h.frequency === 'weekly' ? ('weekly' as const) : ('daily' as const),
        }
      : null;
  const msRaw = Array.isArray(o.milestones) ? o.milestones : null;
  const milestones: PlanMilestone[] | null =
    pacingMode === 'custom' && msRaw
      ? msRaw
          .map((m): PlanMilestone | null => {
            const obj = m as Record<string, unknown>;
            const label =
              typeof obj?.label === 'string' ? obj.label.trim() : '';
            if (!label) return null;
            return {
              label: label.slice(0, 80),
              target:
                typeof obj.target === 'number' && Number.isFinite(obj.target)
                  ? obj.target
                  : undefined,
              by:
                typeof obj.by === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.by)
                  ? obj.by
                  : undefined,
            };
          })
          .filter((m): m is PlanMilestone => m !== null)
          .slice(0, 12)
      : null;
  return {
    pacingMode,
    target:
      typeof o.target === 'number' && Number.isFinite(o.target)
        ? o.target
        : null,
    weeks,
    habit,
    milestones,
    rationale:
      typeof o.rationale === 'string' ? o.rationale.slice(0, 500) : '',
    spokenResponse:
      typeof o.spokenResponse === 'string'
        ? o.spokenResponse.slice(0, 500)
        : '',
  };
}

/**
 * Claude-генерация дерева (по эталону extractFromTranscript).
 * decision уже определён classifyGoal (decompose|partial). Правила
 * Берика зашиты в промпт. Возврат null = честно «не смог разложить»
 * (caller НЕ выдумывает план).
 */
export async function generatePlanTree(
  goal: string,
  decision: Exclude<GoalDecision, 'keep_atomic'>,
  todayIso: string,
): Promise<PlanTree | null> {
  const partialRule =
    decision === 'partial'
      ? 'Это ПРОЕКТ С ДЕДЛАЙНОМ → milestones по датам (pacingMode:"custom", milestones[]), НЕ ежедневная привычка. habit может быть null.'
      : 'Это измеримая жизненная цель → ОБЯЗАТЕЛЬНО дойди до ДНЕВНОГО действия: weeks[] (недельные цели) + ОДНА конкретная привычка habit (что делать каждый день/неделю). Без привычки план мёртв.';
  const systemPrompt = `Ты — JARVIS-планировщик. Разложи цель пользователя в дерево. Сегодня ${todayIso}.

Верни ТОЛЬКО валидный JSON без markdown:
{
  "pacingMode": "uniform" | "custom",
  "target": число или null,
  "weeks": [ { "text": "недельная цель", "metric": "опц. ориентир" } ],
  "habit": { "name": "ежедневное/недельное действие", "frequency": "daily" | "weekly" } | null,
  "milestones": [ { "label": "Q1/Месяц 1", "target": число, "by": "YYYY-MM-DD" } ] | null,
  "rationale": "1-2 предложения почему так",
  "spokenResponse": "короткое тёплое подтверждение юзеру, 1-2 предложения"
}

ПРАВИЛА:
1. ${partialRule}
2. pacingMode: РАВНОМЕРНЫЙ темп (повтор/счёт/обучение часов-в-день, напр. «50 книг», «учить язык») → "uniform", milestones=null. НЕРАВНОМЕРНЫЙ (вес, тренировки, деньги с нестабильным доходом — «10 кг», «миллион к НГ») → "custom" + milestones[] с датами.
3. target — числовая величина цели (50, 1000000, 10) или null если неизмеримо.
4. weeks — 3-8 реалистичных недельных шагов под темп. metric — конкретный ориентир («≈1 книга», «≈8 км»).
5. Не выдумывай. Мало данных — минимальное честное дерево, не раздувай.
6. spokenResponse — ТЁПЛО, кратко, без markdown, без цитирования юзера.`;

  let res;
  try {
    res = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: goal.slice(0, 300) }],
    });
  } catch (err) {
    throw new AiModelError(err instanceof Error ? err : new Error(String(err)));
  }
  const c = res.content[0];
  if (!c || c.type !== 'text') return null;
  return parsePlanTree(c.text);
}

export function classifyGoal(text: string): GoalDecision {
  const t = text.trim();
  // Проект С дедлайном → milestones (НЕ по дням). Проверяем первым:
  // «запустить сайт к 1 сентября» — это не ежедневная привычка.
  if (PARTIAL_PROJECT.test(t) && PARTIAL_DEADLINE.test(t)) return 'partial';
  // Измеримая жизненная цель → полный каскад до привычки/задачи.
  if (DECOMPOSE.test(t)) return 'decompose';
  // Всё остальное (разовое: встреча/ДР/покупка/звонок) + спорное —
  // conservative bias: НЕ разбиваем.
  return 'keep_atomic';
}
