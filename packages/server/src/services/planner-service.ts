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
import { prisma } from '../lib/prisma.js';
import { AiModelError } from '../lib/errors.js';
import { localDateStr } from '../lib/tz.js';

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

/** Цель → area YearlyGoal (CLAUDE.md: finance|health|career|
 *  spirituality, иначе personal). Детерминированно. */
export function goalAreaFor(text: string): string {
  const t = text.toLowerCase();
  if (/накопи|миллион|млн|сэконом|зарабат|доход|деньг|бюджет|финанс/.test(t))
    return 'finance';
  if (/похуд|кг|сброси|набра|бега|пробеж|трениров|спорт|зал|форм[уы]|здоров|сон|питани/.test(t))
    return 'health';
  if (/медит|духов|молитв|благодар|осознанн|психолог|спокой/.test(t))
    return 'spirituality';
  if (/книг|чита|выучи|изучи|научи|освои|язык|английск|курс|карьер|работ|бизнес|навык|диплом|проект/.test(t))
    return 'career';
  return 'personal';
}

/**
 * W11 (L99 hardening): локальная «сегодня» юзера как UTC-полночь даты
 * (совместимо с @db.Date). Через тот же lib/tz.localDateStr, что и
 * get_today — НЕ сырой new Date()/UTC. Иначе для Алматы (UTC+5) в пн
 * 00:30 локально (=вс 19:30 UTC) weekStart уезжал на прошлый
 * понедельник (тот же класс, что был фикс get_today). Чистая,
 * тестируется без сети (localDateStr — Intl, детерминирована).
 */
export function localTodayUTC(tz: string, at: Date = new Date()): Date {
  const [y, m, d] = localDateStr(tz, at).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Понедельник недели (UTC, 00:00) для даты. */
export function mondayUTC(d: Date): Date {
  const x = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dow = x.getUTCDay(); // 0=вс..6=сб
  const diff = dow === 0 ? 6 : dow - 1; // к понедельнику
  x.setUTCDate(x.getUTCDate() - diff);
  return x;
}

export interface WeeklyGoalRow {
  weekStart: Date;
  goalText: string;
  order: number;
  planParentId: string;
  planParentType: 'YearlyGoal';
  derivedFrom: 'planner';
}
export interface HabitRow {
  name: string;
  category: string;
  frequency: string;
  goalId: string; // legacy прямая связь
  planParentId: string;
  planParentType: 'YearlyGoal';
  derivedFrom: 'planner';
}
export interface PlannerRows {
  weeklyGoals: WeeklyGoalRow[];
  habit: HabitRow | null;
  yearlyPatch: {
    target: number | null;
    pacingMode: 'uniform' | 'custom';
    pacingPlan: PlanMilestone[] | null;
  };
}

/**
 * Чистое отображение PlanTree → строки БД. Тестируется БЕЗ БД
 * (детерминированный инвариант — паттерн materializeImport).
 * weekStart = понедельник от fromDate + i·7дн (ближний горизонт,
 * НЕ 52 фабрикованных строки — честно). order=i. Дети
 * derivedFrom='planner' (никогда не трогаем 'user').
 */
export function planTreeToRows(
  tree: PlanTree,
  yearlyGoalId: string,
  goalArea: string,
  fromDate: Date,
): PlannerRows {
  const m0 = mondayUTC(fromDate);
  const weeklyGoals: WeeklyGoalRow[] = tree.weeks.map((w, i) => {
    const ws = new Date(m0);
    ws.setUTCDate(ws.getUTCDate() + i * 7);
    return {
      weekStart: ws,
      goalText: (w.metric ? `${w.text} (${w.metric})` : w.text).slice(0, 300),
      order: i,
      planParentId: yearlyGoalId,
      planParentType: 'YearlyGoal' as const,
      derivedFrom: 'planner' as const,
    };
  });
  const habit: HabitRow | null = tree.habit
    ? {
        name: tree.habit.name.slice(0, 200),
        category: goalArea === 'personal' ? 'personal' : goalArea,
        frequency: tree.habit.frequency,
        goalId: yearlyGoalId,
        planParentId: yearlyGoalId,
        planParentType: 'YearlyGoal' as const,
        derivedFrom: 'planner' as const,
      }
    : null;
  return {
    weeklyGoals,
    habit,
    yearlyPatch: {
      target: tree.target,
      pacingMode: tree.pacingMode,
      pacingPlan:
        tree.pacingMode === 'custom' ? tree.milestones ?? null : null,
    },
  };
}

/**
 * W12 (L99 hardening) — единый named-инвариант non-destructive:
 * planner патчит target/pacingMode/pacingPlan родителя ТОЛЬКО если
 * СОЗДАЛ YearlyGoal в этом же вызове (он пустой). Найденную/ручную
 * (derivedFrom='user') цель НИКОГДА не перезаписываем — иначе
 * «разбей мою цель» затрёт target, который юзер поставил руками
 * (потеря пользовательских данных). Дети (WeeklyGoal/Habit) — всегда
 * чистый INSERT, тут разрушать нечего. Покрыт тестом → non-destructive
 * ДОКАЗАН, не «по намерению».
 */
export function plannerMayPatchParent(createdByThisCall: boolean): boolean {
  return createdByThisCall;
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

export interface PlannerResult {
  decision: GoalDecision;
  created: number;
  goalId?: string;
  message: string;
}

/**
 * Phase 5 P2 шаг 3c.3/3d — персист дерева (DB-glue, доверяем как
 * materializeImport; чистые части classify/parse/map покрыты юнитами).
 *
 * Инварианты аудита L99:
 *  W1 find-or-create YearlyGoal (root=цель юзера, derivedFrom='user').
 *  W6 идемпотентно: есть planner-дети → НЕ дублируем (честный skip),
 *     re-decompose = шаги 4/5 (нужен archivedAt).
 *  non-destructive: трогаем ТОЛЬКО derivedFrom='planner', никогда
 *     ручные 'user'-строки.
 *  Честность (bug #1): счётчики — РЕАЛЬНО созданные строки; нет
 *     дерева/keep_atomic → 0 создано + честный текст, не выдумка.
 */
export async function persistPlan(
  userId: string,
  goal: string,
  goalId?: string,
): Promise<PlannerResult> {
  const g = goal.trim();
  const decision = classifyGoal(g);
  if (decision === 'keep_atomic') {
    return {
      decision,
      created: 0,
      message:
        'Это разовое дело, не цель для разбивки. Скажи «создай ' +
        'задачу/событие» — поставлю напрямую.',
    };
  }

  // W11: всё date-math в таймзоне юзера (как get_today), не сырой UTC.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const tz = user?.timezone || 'Asia/Almaty';
  const todayUTC = localTodayUTC(tz);
  const year = todayUTC.getUTCFullYear();
  const area = goalAreaFor(g);

  // W1: find-or-create корневой YearlyGoal.
  let yg = goalId
    ? await prisma.yearlyGoal.findFirst({ where: { id: goalId, userId } })
    : await prisma.yearlyGoal.findFirst({
        where: {
          userId,
          year,
          goalText: { contains: g.slice(0, 60), mode: 'insensitive' },
        },
      });
  // W12: создал ли planner родителя ИМЕННО в этом вызове. Найденная
  // (user) цель — чужие данные: target/pacing НЕ перезаписываем.
  let createdNow = false;
  if (!yg) {
    yg = await prisma.yearlyGoal.create({
      data: {
        userId,
        year,
        area,
        goalText: g.slice(0, 300),
        progress: 0,
        derivedFrom: 'user', // цель юзера; planner лишь структурирует
      },
    });
    createdNow = true;
  }

  // W6: идемпотентность — есть planner-дети → не дублируем.
  const existing = await prisma.weeklyGoal.count({
    where: { userId, planParentId: yg.id, derivedFrom: 'planner' },
  });
  if (existing > 0) {
    return {
      decision,
      created: 0,
      goalId: yg.id,
      message:
        `План под цель «${yg.goalText.slice(0, 60)}» уже построен ` +
        `(${existing} недельных шагов). Не дублирую. ` +
        `«Перестрой план» — пересоберу заново (скоро).`,
    };
  }

  // Дерево через Claude. null → честный отказ, НИЧЕГО не создаём.
  let tree: PlanTree | null;
  try {
    tree = await generatePlanTree(
      g,
      decision,
      new Date().toISOString().slice(0, 10),
    );
  } catch {
    tree = null;
  }
  if (!tree) {
    return {
      decision,
      created: 0,
      goalId: yg.id,
      message:
        'Не смог разложить эту цель сейчас — сбой/мало данных. ' +
        'Ничего не создал. Переформулируй короче или попробуй позже.',
    };
  }

  const rows = planTreeToRows(tree, yg.id, area, todayUTC);

  // Транзакция: недельные цели + привычка + патч YearlyGoal.
  // non-destructive — только INSERT planner-строк + UPDATE pacing.
  let created = 0;
  await prisma.$transaction(async (tx) => {
    for (const w of rows.weeklyGoals) {
      await tx.weeklyGoal.create({
        data: {
          userId,
          weekStart: w.weekStart,
          goalText: w.goalText,
          order: w.order,
          planParentId: w.planParentId,
          planParentType: w.planParentType,
          derivedFrom: w.derivedFrom,
        },
      });
      created++;
    }
    if (rows.habit) {
      await tx.habit.create({
        data: {
          userId,
          name: rows.habit.name,
          category: rows.habit.category,
          frequency: rows.habit.frequency,
          goalId: rows.habit.goalId,
          planParentId: rows.habit.planParentId,
          planParentType: rows.habit.planParentType,
          derivedFrom: rows.habit.derivedFrom,
        },
      });
      created++;
    }
    // W12 non-destructive: патчим родителя ТОЛЬКО если planner создал
    // его в этом вызове. Найденная user-цель — не трогаем (юзер мог
    // сам поставить target; перезапись = потеря пользовательских
    // данных, прямое нарушение инварианта аудита).
    if (plannerMayPatchParent(createdNow)) {
      await tx.yearlyGoal.update({
        where: { id: yg!.id },
        data: {
          target: rows.yearlyPatch.target,
          pacingMode: rows.yearlyPatch.pacingMode,
          pacingPlan:
            rows.yearlyPatch.pacingPlan === null
              ? undefined
              : (rows.yearlyPatch.pacingPlan as unknown as object),
        },
      });
    }
  });

  const habitNote = rows.habit
    ? ` + привычка «${rows.habit.name}» — отмечай каждый день, она ведёт к цели`
    : '';
  return {
    decision,
    created,
    goalId: yg.id,
    message:
      tree.spokenResponse?.trim() ||
      `Разложил цель: ${rows.weeklyGoals.length} недельных шагов${habitNote}.`,
  };
}
