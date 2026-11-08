import { prisma } from '../lib/prisma.js';
import { parseIntent } from '../ai/intent-parser.js';
import {
  getAssistantReply,
  gatherAssistantContext,
  ritualOptsFor,
} from './assistant-service.js';
import { buildJarvisPrompt } from '../ai/jarvis-prompt.js';
import { extractFromTranscript, extractFromChat } from './dictation-service.js';
import {
  parseBookingIntent,
  buildBookingUrl,
  narrateBooking,
  tripReadiness,
  type BookingContext,
} from './smart-booking.js';
import { runAgent } from './claude-agent.js';
import { AgentDeadlineError, TURN_DEADLINE_MS, deadlineReplyText } from '../lib/agent-deadline.js';
import { userNumberClaims, ungroundedClaims } from '../lib/chat-number-claims.js';
import { createTurnTiming } from '../lib/turn-timing.js';
import { buildConfirmPrompt } from './confirm-prompt.js';
import { matchesCrisisPhrase, classifyCrisis } from './safety-classifier.js';
import { buildSafetyResponse } from './safety-response.js';
import { classifyEmotional } from './emotional-classifier.js';
import { emotionForTurn, type RobotEmotion, type TurnFacts } from './robot-emotion.js';
import { isPlannerIntent } from './planner-service.js';
import { writeMemory, supersedeByTopic } from './episodic-memory.js';
import { trackInterests } from './interest-service.js';
import { runRegistryTool, toolConfirmRequired } from '../tools/index.js';
import { isFailedResult } from './tool-activity-summary.js';
import { maybeSavingsCoachLine } from './savings-coach.js';
import { commitGoal, type CommitGoalInput } from './goal-commit.js';
import { getToolCounts } from './tool-audit.js';
import {
  peekPendingAction,
  pendingStagedSince,
  takePendingAction,
  setPendingAction,
  clearPendingAction,
  readConfirmSignal,
  awaitingSlot,
  clientPendingInput,
} from './pending-actions.js';
import { isV2MemoryEnabled } from '../lib/feature-flags.js';
import { captureV2InBackground } from './v2-capture.js';
import {
  buildV2EnrichmentBlock,
  fetchV2EnrichmentData,
  fetchV2EnrichmentAxesSection,
  fetchV2EnrichmentToneSection,
} from './v2-enrichment.js';
import { withTimeout } from '../lib/with-timeout.js';
import { RESCHEDULE_ACTION, applyReschedule } from './reschedule.js';
import { DEAL_INCOME_ACTION, recordDealIncome, fmtMoneyExact, routeIncomeToDeal, describePossibleDuplicate, updateDeal, noteDealAdvance, textMentionsClient, openDealsForMatching, DEAL_INCOME_CHOICE, PARTIAL_PAYMENT, JUST_INCOME_EXIT, JUST_INCOME_RE } from './deals/index.js';
import { isV2DealsEnabled } from '../lib/feature-flags.js';
import { shouldForceOneStep, extractStepCount } from './user-axes/content-rules.js';
import { getUserAxesStore } from './user-axes/index.js';
import { isV2AxesEnabled as isV2AxesEnabledFlag } from '../lib/feature-flags.js';
import { getBotTraitsStore } from './bot-traits/index.js';
import { isV2IdentityEnabled } from '../lib/feature-flags.js';
import { isV2HermesEnabled } from '../lib/feature-flags.js';
import { isV2RealtimeEnabled } from '../lib/feature-flags.js';
import { getUserTimezone } from '../lib/user-context.js';
import { civilDayRefs, dateOnlyUTC } from '../lib/tz.js';
import {
  isV2InlineNudgeEnabled,
  isV2SavingsCoachEnabled,
  isV2ObligationsEnabled,
  isV2AntiFabEnabled,
  isV2MemQualityEnabled,
  isV2SupersedeEnabled,
} from '../lib/feature-flags.js';
import {
  routeToSkill,
  buildSkillInstruction,
  getHermesStore,
  runSkillPlan,
  type SkillSpec,
} from './hermes/index.js';

/**
 * JARVIS Orchestrator — единый мозг. Любое сообщение (текст или
 * расшифрованный голос) проходит сюда. Раньше голос ВСЕГДА шёл в диктофон
 * (просто запись задач) — это и делало бота "блокнотом". Теперь:
 *
 *   сообщение → понять намерение →
 *     ├─ booking      → агентный flow: web-поиск цен + ссылка + вопросы
 *     ├─ dictation    → только если явно "запиши/диктофон"
 *     └─ всё остальное → JARVIS-чат (web search + память + история диалога)
 *                        + фоновое извлечение задач/фактов (ничего не теряем)
 *
 * Ответ — как от думающего ассистента, который действует и спрашивает,
 * а не пассивно записывает.
 */

// C (spec 2026-06-01): сколько символов сообщения храним/обрабатываем.
// Раньше 4000 обрезало длинный рассказ. 16000 покрывает «рассказ»;
// чанкинг гигантских — позже (YAGNI). Стоимость токенов ограничена
// дневным AI-лимитом (security.aiDailyLimiter).
const MAX_USER_TEXT = 16000;
/** Голосовой ответ (≤3 предложения, озвучивается) — короче лимит: быстрее приходит. */
const VOICE_MAX_TOKENS = 400;

export interface JarvisResponse {
  reply: string;
  /** URL для бронирования если это booking-запрос */
  bookingUrl?: string | null;
  /**
   * SSOT Step 7: бейдж — РЕАЛЬНОЕ число исполненных за этот ход
   * инструментов из аудита ToolCall, НЕ из NLP-выдумки
   * captureInBackground. Невозможно соврать: 0 действий → нет бейджа.
   */
  auditedActions?: number;
  intent: string;
  /**
   * Фаза 1.2: денежное/необратимое действие НЕ выполнено — ждём
   * подтверждения. Приложение показывает кнопку «Подтвердить» и шлёт
   * на /voice/confirm-action. Telegram/голос — юзер отвечает «да/нет».
   */
  pendingAction?: { action: string; input: Record<string, unknown> } | null;
  confirmationText?: string;
  /**
   * Робот-эпик, Часть 2: эмоция робота-аватара на этот ход — считается по
   * фактам хода (emotionForTurn), без отдельного вызова ИИ. Ставится обёрткой
   * handleMessage на КАЖДОМ пути.
   */
  emotion?: RobotEmotion;
  /** Внутреннее: факты хода для emotionForTurn (обёртка снимает перед ответом). */
  turnFacts?: Partial<TurnFacts>;
  /**
   * Робот-эпик, Часть 3: «покажи/открой X» → приложение открывает панель
   * (tasks|habits|goals|finance|calendar|journal|today). null — не открывать.
   */
  openPanel?: string | null;
}

/** Флаг сделок выключен → «покажи сделки» не панель, а как до фичи (ревью I4). */
const DEALS_PANEL_OFF: ReadonlySet<string> = new Set(['deals']);

const PANEL_REPLY: Record<string, string> = {
  tasks: 'Открываю задачи',
  habits: 'Открываю привычки',
  goals: 'Открываю цели',
  finance: 'Открываю финансы',
  calendar: 'Открываю календарь',
  journal: 'Открываю дневник',
  deals: 'Открываю сделки',
  today: 'Вот твой день',
};

/**
 * ISSUE-8 gate: стоит ли вообще NLP-извлекать задачи/факты из этой
 * реплики. Чистая детерминированная эвристика (без LLM/БД). Цель —
 * убрать мусор (вопросы/болтовня → фейковые задачи), сохранив
 * осмысленный ambient-capture («купи продукты», «надо позвонить»).
 * Лучше пропустить сомнительное (не плодить мусор), чем извлечь.
 */
/**
 * Этап 4: стоит ли после выполненного действия вытащить факты/людей.
 * Задачи на этом пути не создаются, поэтому фильтр looksCaptureWorthy
 * (он против мусорных задач и денежные фразы отсекает) тут не подходит.
 * Берём фразы с именем собственным не в начале предложения («ужин с
 * Сериком», «подарок для Даны») — без лишнего вызова модели на каждое
 * «добавь задачу купить хлеб».
 */
/**
 * Память о пользователе: факты о себе и близких приходят и в болтовне —
 * «Привет, меня зовут Берик, у меня компания с турникетами», «Расскажу о
 * себе: брат Ерлан живёт в Астане». looksCaptureWorthy такие реплики
 * отсекал (он против мусорных ЗАДАЧ), и экран «Что я о тебе помню» оставался
 * пустым. Здесь — отдельный, мягкий фильтр только для фактов/людей.
 */
export function looksMemoryWorthy(text: string): boolean {
  const t = text.trim();
  if (t.length < 12 || t.endsWith('?')) return false;
  const SELF = /(?:^|[^а-яё])(?:я|меня|мне|мой|моя|моё|мое|мои|моего|моей|моих|моим|нас|наш|наша|наше|наши)(?=[^а-яё]|$)/i;
  const CLOSE =
    /(?:^|[^а-яё])(?:мам|пап|брат|сестр|жен[аеуыо]|муж[аеуь]?(?=[^а-яё]|$)|сын|доч|друз|друг|подруг|бабушк|дедушк|коллег|начальник|партн[её]р|зовут|работаю|живу|живём|живем|люблю|ненавижу|боюсь|мечтаю|увлекаюсь|компани|бизнес|родил)/i;
  return SELF.test(t) && CLOSE.test(t);
}

export function looksPeopleWorthy(text: string): boolean {
  const t = text.trim();
  if (t.length < 12 || t.endsWith('?')) return false;
  return /[^.!?\s]\s+[А-ЯЁ][а-яё]{2,}/.test(t);
}

export function looksCaptureWorthy(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false; // «да», «спасибо», «ок», приветствия
  if (t.endsWith('?')) return false; // вопрос — не задача
  // Вопросительные/просьба-к-ассистенту в начале (без \b —
  // кириллица; lookahead на пробел/пунктуацию/конец).
  const NON_TASK_START =
    /^(?:как|что|почему|зачем|когда|где|кто|скольк[оа]|каков|как(?:ой|ая|ие|ое)|можешь|можно ли|стоит ли|нужно ли|правда ли|расскажи|объясни|посоветуй|подскажи|привет|здравствуй|спасибо|мотивируй|развесели|пошути|как дела|как ты|ты кто|что умеешь|кто ты)(?=\s|$|[?!,.])/i;
  if (NON_TASK_START.test(t)) return false;
  // ISSUE-8 усиление: команды АССИСТЕНТУ/приложению — НЕ личные
  // дела. Их оркестратор сам исполняет/отклоняет; captureInBackground
  // не должен лепить из них мусорную задачу (кейс «поставь будильник»
  // → бот сказал «не умею», а NLP всё равно создал задачу «Будильник
  // 7 утра»). Личный ambient («купи продукты», «надо позвонить») —
  // этих маркеров не содержит, проходит как раньше.
  const ASSISTANT_CONTROL =
    /(будильник|открой экран|открой финанс|открой настройк|экспортир|в телеграм|в whatsapp|в ватсап|в вотсап|перенеси задач|в колонк|фокус-режим|фокус режим|включи фокус|покажи (?:мой |мне )?календар|покажи задач|открой приложени)/i;
  if (ASSISTANT_CONTROL.test(t)) return false;
  // ISSUE-3 (defense-in-depth): денежные/record-команды — это
  // add_expense/add_income, НЕ личные задачи. intent-parser
  // промахивается (STT даёт «две тысячи» вместо цифр, филлеры,
  // не-^якорь) → fall-through → раньше captureInBackground лепил
  // «Записать расход N тенге …» как задачу-мусор (cmpb8eluz и др.,
  // 2026-05-18, ПОСЛЕ ISSUE-8-хардена → дыра живая). Гейт —
  // последняя защита: команда о деньгах НИКОГДА не задача.
  // «купи/купить …» (будущее, не record) и «записать <не-деньги>»
  // (к врачу) — НЕ под исключением, проходят как ambient.
  const MONEY_RECORD =
    /(?:^|\s)(?:расход|доход)(?:[\s:.,!?]|$)|потрат(?:ил|ила|или|ить|ь|им)|истрат(?:ил|ила|или|ить)|заработал[аи]?|(?:получил[аи]?|пришла)\s+зарплат|зарплат[ауые]|(?:запиши|записать|добав[ьи]|внес[иь]|отметь)\s+(?:\S+\s+){0,2}?(?:расход|доход|трат|зарплат|преми)/i;
  if (MONEY_RECORD.test(t)) return false;
  // L99/W4 SSOT: planner-интент распознаёт ЕДИНАЯ isPlannerIntent
  // из planner-service (не локальный regex — иначе два детектора
  // разойдутся). «разбей мою цель…» идёт в decompose_goal (реальное
  // дерево); capture НЕ должен параллельно лепить мусор (артефакт
  // cmpbhm7n* из ISSUE-3 cleanup). intent-symmetry.test фиксирует.
  if (isPlannerIntent(t)) return false;
  return true;
}

/**
 * Фоновое извлечение задач/фактов из сообщения. Не блокирует ответ.
 * Так "купи продукты" станет задачей даже когда основной режим — чат.
 */
async function captureInBackground(
  userId: string,
  text: string,
  msgId?: string,
  /** Действие уже выполнено (трата/задача записаны) — берём только факты и
   *  людей, задачи не создаём (иначе дубль «созданной» задачи). */
  opts: { memoriesOnly?: boolean } = {},
): Promise<{ tasks: number; memories: number }> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    // intent-TZ фикс: «сегодня/завтра» в извлечённых задачах = календарь юзера.
    const tz = await getUserTimezone(userId);
    const todayCivil = civilDayRefs(tz).today;
    const extracted = isV2MemQualityEnabled(userId)
      ? await extractFromChat(text, user?.name || 'друг', { detectSupersede: isV2SupersedeEnabled(userId), tz })
      : await extractFromTranscript(text, user?.name || 'друг', tz);
    let tasks = 0;
    let memories = 0;
    if (!opts.memoriesOnly && extracted.tasks.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const t of extracted.tasks) {
          await tx.task.create({
            data: {
              userId,
              title: t.title.slice(0, 500),
              category: (t.category || 'personal').slice(0, 32),
              priority: (t.priority || 'medium').slice(0, 32),
              date: new Date(
                (t.date || todayCivil) + 'T00:00:00Z',
              ),
              time: t.time?.slice(0, 8) ?? null,
              notes: t.notes?.slice(0, 2000) ?? null,
            },
          });
          tasks++;
        }
      });
    }
    // Память — вне task-транзакции: writeMemory дедуплицирует и делает
    // собственные запросы — в tx неуместно. Память best-effort, с
    // задачами не атомарна по смыслу.
    for (const m of extracted.memories) {
      // ОДНА ПАМЯТЬ (M3 Unit A): ЕДИНЫЙ писатель writeMemory (дедуп+embedding+
      // episodic-поля). Legacy captureMemory удалён (FEATURE_V2_WRITE=all в проде).
      const r = await writeMemory(userId, {
        type: m.type,
        content: m.content,
        details: m.details ?? null,
        source: 'chat',
        tags: m.tags,
        importance: m.importance,
      });
      memories++;
      if (isV2SupersedeEnabled(userId) && m.supersedesTopic && r.action !== 'skipped') {
        await supersedeByTopic(userId, m.type, m.supersedesTopic, r.id).catch(() => null);
      }
    }
    // v2.0 Week 5 D3 — dual-write to new memory tiers behind flag.
    // Fire-and-forget so legacy capture's return time is unchanged;
    // captureV2InBackground itself has top-level try/catch and never throws.
    if (isV2MemoryEnabled(userId)) {
      void captureV2InBackground(userId, text, msgId ?? 'unknown').catch(
        (err) => console.warn('[v2-capture] hook:', err),
      );
    }
    return { tasks, memories };
  } catch {
    return { tasks: 0, memories: 0 };
  }
}

/** Последние реплики диалога юзера (для continuity follow-up вопросов). */
async function getRecentHistory(
  userId: string,
  limit = 6,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const rows = await prisma.chatMessage.findMany({
    // Phase 6 C1 crisis-isolation (d): кризис-ходы НЕ попадают в
    // сырой LLM-контекст (иначе toxic/обычная модель может их
    // эхнуть). Заботливый follow-up — работа C4-рефлектора через
    // структурный путь, НЕ через сырую историю. UI /chat/history
    // НЕ фильтрует (это собственный диалог юзера — решение Берика).
    where: { userId, crisis: false },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { role: true, content: true },
  });
  return rows
    .reverse()
    .map((r) => ({
      role: r.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: r.content,
    }));
}

async function saveTurn(
  userId: string,
  userText: string,
  assistantText: string,
  // Phase 6 C1 — sensitive-флаг. default false → 7 существующих
  // вызовов не меняют поведение (аддитивно, #5). При кризисе
  // ОБЕ строки помечаются (весь ход sensitive: вопрос юзера +
  // safety-ответ) — изоляция от analytics/retention/шифрования.
  crisis = false,
): Promise<void> {
  try {
    await prisma.chatMessage.createMany({
      data: [
        { userId, role: 'user', content: userText.slice(0, MAX_USER_TEXT), crisis },
        {
          userId,
          role: 'assistant',
          content: assistantText.slice(0, MAX_USER_TEXT),
          crisis,
        },
      ],
    });
  } catch {
    /* история — не критично, не валим запрос */
  }
}

// Fix D: эвристика «сообщению нужны локальные инструменты». Без \b —
// кириллические границы в JS не работают; ловим по подстрокам корней.
// Корни сделок — отдельно (DEAL_TOOL_HINTS), только при включённых сделках.
// Этап 0 (2026-11-06): у 16 инструментов не было ни одного корня — модель
// без инструментов отвечала «не могу записать». Каждый пример инструмента
// (tool.examples) обязан сюда доходить — это сторожит tool-roles.test.ts.
const TOOL_HINTS_BASE =
  /(задач|календар|встреч|событи|бюджет|потрат|расход|доход|привычк|напомн|почт|письм|gmail|расписан|план(?!ета)|поездк|цел[ьия]|сколько|что у меня|что сегодня|что по|добав|созда|отмет|перенес|свобод|кто так|телефон|контакт|номер|что я говорил про|помнишь про|погод|надеть|надену|одет|оденусь|выезж|вылет|лечу|бронь|билет|когда у меня|навык)/i;
const TOOL_HINTS_MORE: readonly RegExp[] = [
  // дата и свободное время, просрочки, цели недели/месяца
  /(день недели|(?:какое|какой|каким)\s+(?:сегодня\s+)?числ|числ[оа]\s+сегодня|найди\s+(?:мне\s+)?(?:\d|время|окно)|просроч|на этой неделе|в этом месяце)/i,
  // привычки и дневник
  /(сделал|медитац|зарядк|тренировк|дневник|настроени|самочувств|энерги|выспал|(?:^|[^а-яё])спал(?:[аи]|ось)?(?![а-яё]))/i,
  // деньги: трата начинается с суммы, правка/отмена траты, лимиты
  /(^\s*\d[\d\s]{2,}\s*(?:₸|тг|тенге)?\s*[а-яёa-z]|комисси|трат|стало\s+\d|лимит|баланс|на счету|на карте|отмени)/i,
  // решения и советы
  /(реши\s*:|решени|решил|сработал|себестоим|примени|сделай как|telegram|телеграм|скинь)/i,
  // перелёты
  /(лететь|перел[её]т|авиабил)/i,
  // поиск по памяти (search_memory уходит агенту — ему нужен recall_person)
  /(помнишь|в памяти|что ты знаешь (?:о|об|про)\s|рассказывал про)/i,
  // люди: запомнить, связи, ДР, роли
  /(запомни|свяжи|расстал|уволил|не работаю|день рожд|(?:^|[^а-яё])др(?![а-яё])|партн[её]р|семь[яеиюё]|коллег)/i,
  // письма (jarvis-roadmap №4): написать/отправить на почту, адрес человека
  /(письм[оауе]|на\s+почту|e-?mail|имейл|емейл|мейл|gmail|@[a-z0-9-]+\.[a-z]{2,})/i,
  // время = деньги и команда (jarvis-roadmap №3): цена часа, сотрудники и их роли
  /(час\s+стоит|стоимость\s+(?:моего\s+)?часа|ставк[аиу]\s+(?:в|за)\s+час|в\s+час\s+зарабатыва|(?:наш|моя|мой|у\s+нас)\s+(?:бухгалтер|юрист|менеджер|дизайнер|программист|ассистент|помощни)|сотрудни|в\s+команд|подчин|передай\s|делегир)/i,
  // прогресс целей и обязательства
  /(прочитал|сбросил|выучил|пробежал|похудел|накопил|должен|должн|(?:^|[^а-яё])долг(?:[аиуе]|ом|ов|ам|ами|ах)?(?![а-яё])|обещ|обязательств|вернул|отдал|не актуальн|неактуальн)/i,
];
/** Короче — болтовня («ок», «задач?»); «что надеть», «куда я лечу» — уже нет. */
const MIN_TOOL_TEXT = 8;

/**
 * Сделки (ревью B1/I-b, ревью-3 I5): «отправил КП», «оплатил», «на 2 млн», «как воронка»,
 * «на 500 тысяч», «за 800к», «выставила счёт», «подписал контракт», «перевёл 500 000».
 * Корни, которые живут и в болтовне, — только в контексте сделки: «счёт» — с глаголом
 * «выставил/отправил…» или с числом («насчёт», «за счёт», «счёт в матче» — мимо);
 * «тыс» — после числа («тысяча чертей» — мимо); «перевёл/скинул» — с суммой
 * («перевёл статью», «скинул вес» — мимо); «предложение» — только если его отправили;
 * «согласился» — на условия/сделку/цену.
 */
const DEAL_TOOL_HINTS: readonly RegExp[] = [
  /(сделк|воронк|продаж|клиент|(?:^|\s)кп(?=\s|$|[,.!?])|оплатил|заплатил|отказал|перегов|договор|перезвон|млн|миллион|контракт|подписал|передумал)/i,
  /\d\s*тыс/i,
  /\d\s*к(?=\s|$|[.,!?])/i,
  /(?:выстав|отправ|выслал|скинул|прислал|оплатил)[а-яё]*\s+(?:[а-яё]+\s+)?сч[её]т|(?:^|[^а-яё])сч[её]т[а-яё]*\s+(?:на\s+)?\d/i,
  /перев[её]л[аи]?\s+\d/i,
  /скинул[аи]?\s+\d/i,
  /согласил[а-яё]*\s+на\s+(?:услов|сделк|цен)/i,
];
/** «предложение» — только вместе с отправкой («отправил Ахмету предложение»). */
const DEAL_PROPOSAL = /предложени/i;
const DEAL_PROPOSAL_SENT = /(отправ|выслал|скинул)/i;

/**
 * Этап 3: ответ агента БЕЗ инструментов, который на деле про действие —
 * «не могу записать» (словарь не узнал фразу) или «записал/добавил»
 * (без инструментов это выдумка). Такой ответ не отдаём — повторяем заход
 * с инструментами.
 */
const NEEDS_TOOLS_REFUSAL =
  /не\s+(?:могу|получается|получилось|смогу|умею)\s+(?:это\s+|тебе\s+|сейчас\s+)?(?:записать|сохранить|добавить|отметить|создать|запомнить|поставить|удалить|изменить|перенести|внести)/i;
const NEEDS_TOOLS_CLAIM =
  /(?:^|[^а-яё])(?:записал|добавил|сохранил|отметил|создал|запомнил|поставил|внёс|внес|перенёс|перенес|удалил)[аи]?(?![а-яё])/i;
export function replyNeedsTools(reply: string): boolean {
  return NEEDS_TOOLS_REFUSAL.test(reply) || NEEDS_TOOLS_CLAIM.test(reply);
}

/**
 * ISSUE-1: честный отказ когда tool-путь упал, а запрос требовал
 * инструментов. Лучше «не смог», чем тихая выдумка «нашёл/записал».
 */
export const DEGRADED_ACTIONABLE_REFUSAL =
  'Извини, сейчас не получается это выполнить — сбой на моей стороне, ' +
  'не у тебя. Действие НЕ выполнено. Попробуй, пожалуйста, ещё раз через минуту.';

/**
 * «да / давай / да, привяжи» в ответ на ПРЕДЛОЖЕНИЕ робота, когда pending нет
 * (разбор цели «Скажи «да»», нудж «закину в план?», «разгрести вместе?»).
 * Раньше короткое «да» шло к модели БЕЗ инструментов (меньше 8 символов —
 * «болтовня»): она отвечала «привязал / закинул», ничего не сделав (аудит
 * 2026-11-08, H1). Теперь такое согласие всегда идёт с инструментами.
 */
const ACCEPT_OFFER =
  /^(?:да|ага|угу|давай(?:те)?|ок(?:ей)?|хорошо|конечно|го|сделай|поставь|привяжи|разбей|закинь|запланируй|сдвинь|перенеси|разгреби)(?![а-яё])/i;
const OFFER_MARK = /скажи\s+«да»|\?\s*$/im;
export function acceptsRecentOffer(
  text: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 60 || !ACCEPT_OFFER.test(t)) return false;
  const last = history[history.length - 1];
  return !!last && last.role === 'assistant' && OFFER_MARK.test(last.content.trim());
}

export function mayNeedLocalTools(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_TOOL_TEXT) return false; // короткие реплики = болтовня
  return TOOL_HINTS_BASE.test(t) || TOOL_HINTS_MORE.some((re) => re.test(t));
}

/** Словарь сделок (зовётся только при включённых сделках). Порог < 12 символов — тот же. */
export function mayNeedDealTools(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false;
  if (DEAL_TOOL_HINTS.some((re) => re.test(t))) return true;
  return DEAL_PROPOSAL.test(t) && DEAL_PROPOSAL_SENT.test(t);
}

/**
 * Ревью I-b: словаря мало («как там Ахмет по оборудованию?»). При включённых
 * сделках — словарь сделок и имя клиента с открытой сделкой в сообщении тоже
 * включают инструменты. Один запрос (открытые сделки, тот же, что для дохода);
 * сбой — только словари. Флаг off — ровно прежний mayNeedLocalTools.
 */
export async function needsLocalTools(userId: string, text: string): Promise<boolean> {
  if (mayNeedLocalTools(text)) return true;
  if (text.trim().length < 12 || !isV2DealsEnabled(userId)) return false;
  if (mayNeedDealTools(text)) return true;
  try {
    const open = await openDealsForMatching(userId);
    return textMentionsClient(open.map((d) => d.personName), text);
  } catch (err) {
    console.warn('[jarvis] deal-client tools hint skipped:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * ISSUE-2: «отправь мне в телеграм <X>». Если X — это ЗАПРОС-ВЬЮ
 * данных («список задач», «бюджет», «что у меня сегодня»), его надо
 * РЕЗОЛВИТЬ мозгом и слать результат, а не литеральную фразу.
 * Литеральные заметки («напомни купить хлеб», «позвонить маме») —
 * шлём как есть. Детерминированный классификатор (как
 * intent-parser/capture-gate; кириллица — по корням, без \b).
 */
export function isTelegramDataRequest(text: string): boolean {
  // \sдела\b → cyrillic-safe «дела» как целое слово (см. lib/cyrillic-regex).
  return /(задач|^дела |\sдела(?:\s|$|[.,!?;])|список дел|расписани|календар|встреч|событи|бюджет|финанс|потрат|расход|доход|план(?!ета)|на недел|цел[ьияей]|итог|сводк|что у меня|что сегодня|что по|сколько (?:я |потрат|осталось|накоп)|прогресс|статус дня)/i.test(
    text.trim(),
  );
}

function confirmationText(action: string, input: Record<string, unknown>): string {
  if (action === 'add_expense') {
    const amount = Number(input.amount);
    const desc = String(input.description || input.category || '').trim();
    return `Записать расход ${amount} ₸${desc ? ` (${desc})` : ''}? Подтверди — запишу.`;
  }
  if (action === 'add_income') {
    const amount = Number(input.amount);
    const src = String(input.source || '').trim();
    return `Записать доход ${amount} ₸${src ? ` (${src})` : ''}? Подтверди — запишу.`;
  }
  if (action === 'send_telegram') {
    const t = String(input.text || '').trim();
    const preview = t.length > 120 ? t.slice(0, 120) + '…' : t;
    return `Отправить тебе в Telegram: «${preview}»? Подтверди — отправлю.`;
  }
  if (action === 'delete_expense') {
    const amt = input.amount != null ? `${Number(input.amount)} ₸` : '';
    const d = String(input.description || input.category || '').trim();
    const what = input.last
      ? 'последний расход'
      : [amt, d && `(${d})`].filter(Boolean).join(' ') || 'расход';
    return `Удалить ${what}? Подтверди — уберу.`;
  }
  if (action === 'edit_expense') {
    const to = input.newAmount != null ? `${Number(input.newAmount)} ₸` : '';
    const d = String(input.description || input.category || '').trim();
    const what = input.last
      ? 'последний расход'
      : d
        ? `расход (${d})`
        : input.amount != null
          ? `расход ${Number(input.amount)} ₸`
          : 'расход';
    return `Изменить ${what} → ${to}? Подтверди — поправлю.`;
  }
  if (action === 'delete_income') {
    const amt = input.amount != null ? `${Number(input.amount)} ₸` : '';
    const s = String(input.source || '').trim();
    const what = input.last
      ? 'последний доход'
      : [amt, s && `(${s})`].filter(Boolean).join(' ') || 'доход';
    return `Удалить ${what}? Подтверди — уберу.`;
  }
  return 'Подтверди действие — выполню.';
}

/**
 * Подсказка на «да»/«Подтвердить» при переспросе «какая сделка оплачена?» (ревью-3 I3):
 * примеры — из настоящих сделок переспроса, а не выдуманный «Ахмет оплатил оборудование».
 */
export function dealChoiceHint(input: Record<string, unknown>): string {
  if (typeof input.dealId === 'string') {
    return 'Ответь словами: «да» — это полная оплата, закрою сделку; «нет» — запишу доходом и отмечу в сделке аванс. Или скажи «просто доход».';
  }
  const options = Array.isArray(input.options) ? (input.options as Array<{ personName?: unknown; title?: unknown }>) : [];
  const examples = options
    .filter((o) => typeof o.personName === 'string' && typeof o.title === 'string')
    .slice(0, 3)
    .map((o) => `«${String(o.personName)} оплатил ${String(o.title)}»`);
  const name = examples.length ? `, или назови сделку: ${examples.join(' или ')}` : ', или назови сделку';
  return `Не понял, какая оплата. Скажи «просто доход» — запишу обычным доходом${name}.`;
}

/**
 * Обычный доход + заметка «аванс» в сделке после «да» (X1a). Ставит pending, отдаёт
 * ответ хода. Служебный __advanceDealId — только в pending, не клиенту.
 */
async function stageAdvanceIncome(
  userId: string,
  amount: number,
  source: string,
  dealId: string | null,
  dealHead: string | null,
): Promise<JarvisResponse> {
  const input: Record<string, unknown> = { amount, source, ...(dealId ? { __advanceDealId: dealId } : {}) };
  const base = confirmationText('add_income', { amount, source });
  const ctext = dealHead ? `${base} Сделку ${dealHead} не закрываю — отмечу в ней аванс.` : base;
  await setPendingAction(userId, 'add_income', input, ctext);
  return { reply: ctext, pendingAction: { action: 'add_income', input: { amount, source } }, confirmationText: ctext, intent: 'add_income' };
}

async function dealHeadOf(userId: string, dealId: string): Promise<string | null> {
  const d = await prisma.deal.findFirst({ where: { id: dealId, userId }, select: { personName: true, title: true } });
  return d ? `${d.personName} — ${d.title}` : null;
}

/**
 * Доход от клиента с открытой сделкой (ревью B2/X1). Ничего не пишет — только
 * готовит ответ хода: переспрос, предложение «закрыть и записать доход» или
 * обычный доход с пометкой «аванс». null — сделки нет, дальше обычный add_income.
 */
async function routeDealIncome(
  userId: string,
  amount: number,
  source: string,
  text: string,
  opts: { partial?: boolean } = {},
): Promise<JarvisResponse | null> {
  const routed = await routeIncomeToDeal(userId, amount, source, { text, partial: opts.partial });
  if (routed.kind === 'none') return null;
  if (routed.kind === 'ask') {
    // Ревью I-d: помним сумму/источник — «просто доход» запишет обычный доход.
    // Ревью-3 I3: про одну сделку — ещё и dealId («да» закроет её, «нет» — аванс);
    // options — настоящие сделки для подсказки. Кнопок нет (pendingAction в ответ
    // не отдаём): это выбор словами, а не «записать?».
    await setPendingAction(
      userId,
      DEAL_INCOME_CHOICE,
      { amount, source, ...(routed.dealId ? { dealId: routed.dealId } : {}), options: routed.options },
      routed.message,
    );
    return { reply: routed.message, intent: 'update_deal' };
  }
  if (routed.kind === 'advance') return stageAdvanceIncome(userId, amount, source, routed.dealId, routed.dealHead);
  const pa = { action: DEAL_INCOME_ACTION, input: { dealId: routed.dealId, markWon: true, amount: routed.amount } };
  // __source — для «просто доход» (ревью-3 I4) и «проиграна» (N5): обычный доход с тем же источником.
  await setPendingAction(userId, pa.action, { ...pa.input, __source: source }, routed.message);
  return { reply: routed.message, pendingAction: pa, confirmationText: routed.message, intent: 'update_deal' };
}

/** Ревью-3 I3: «да» на «это полная оплата?» — предложить закрыть сделку на пришедшую сумму. */
async function stageFullPayment(userId: string, dealId: string, amount: number, source: string): Promise<JarvisResponse | null> {
  const head = await dealHeadOf(userId, dealId);
  if (!head) return null;
  const input = { dealId, markWon: true, amount, fullPayment: true };
  const ctext = `Сделка ${head}: закрыть как выигранную на ${fmtMoneyExact(amount)} и записать этот доход? Подтверди — запишу. ${JUST_INCOME_EXIT}`;
  await setPendingAction(userId, DEAL_INCOME_ACTION, { ...input, __source: source }, ctext);
  return { reply: ctext, pendingAction: { action: DEAL_INCOME_ACTION, input }, confirmationText: ctext, intent: 'update_deal' };
}

const DEAL_LOST_REFUSAL = 'Сделку отметили проигранной — доход не записал. Скажи «просто доход», если деньги пришли.';

/**
 * «Подтвердить» на доход по сделке. markWon (из маршрутизации дохода) — сначала
 * ставим «выиграна» (+ сумма, если её не было; монеты — внутри updateDeal), потом
 * доход. Сумму дохода берём из сделки в БД, доход пишется ровно один раз.
 */
async function confirmDealIncome(userId: string, input: Record<string, unknown>): Promise<string> {
  const dealId = String(input.dealId ?? '');
  const force = input.force === true;
  // Сумма из предложения («пришло 2 млн»); в повторе с force её нет.
  const offered = typeof input.amount === 'number' && Number.isFinite(input.amount) ? input.amount : null;
  const lines: string[] = [];
  if (input.markWon === true) {
    const cur = await prisma.deal.findFirst({ where: { id: dealId, userId } });
    if (!cur) return 'Сделку не нашёл — ничего не записал.';
    // Ревью-3 N5: пока висело «Подтвердить», сделку в панели отметили проигранной —
    // не воскрешаем её молча. «просто доход» запишет деньги обычным доходом.
    if (cur.stage === 'lost') {
      if (offered != null) {
        await setPendingAction(userId, DEAL_INCOME_CHOICE, { amount: offered, source: String(input.__source ?? '') }, DEAL_LOST_REFUSAL);
      }
      return DEAL_LOST_REFUSAL;
    }
    // Суммы нет — ставим из предложения при любой стадии (в панели могли уже отметить
    // «выиграна» без суммы). «Да, это полная оплата» (fullPayment) — сумма сделки = пришедшая.
    const setAmount = offered != null && (cur.amount == null || (input.fullPayment === true && cur.amount !== offered));
    if (cur.stage !== 'won' || setAmount) {
      await updateDeal(userId, dealId, { ...(cur.stage !== 'won' ? { stage: 'won' as const } : {}), ...(setAmount ? { amount: offered } : {}) });
      if (cur.stage !== 'won') lines.push(`Сделка ${cur.personName} — ${cur.title}: выиграна.`);
    }
  }
  const r = await recordDealIncome(userId, dealId, new Date(), { force });
  if (!r.ok && r.reason === 'possible_duplicate') {
    // Страховка B2: такой доход уже есть — не пишем молча; «да» → повтор с force.
    const q = describePossibleDuplicate(r.amount, r.personName, r.existingDate);
    await setPendingAction(userId, DEAL_INCOME_ACTION, { dealId, force: true }, q);
    lines.push(q);
  } else if (r.ok && !r.already) {
    const d = await prisma.deal.findFirst({ where: { id: dealId, userId }, select: { personName: true, title: true } });
    lines.push(`Записал доход ${fmtMoneyExact(r.amount)} — сделка ${d?.personName ?? ''} — ${d?.title ?? ''}.`);
    // Ревью-3 N5: сумму сделки поменяли в панели — пишем по сделке и говорим ровно, сколько.
    if (offered != null && r.amount !== offered) {
      lines.push(`Сумму сделки поменяли — записал ${fmtMoneyExact(r.amount)}, не ${fmtMoneyExact(offered)}.`);
    }
  } else if (r.ok) {
    lines.push('Доход по этой сделке уже записан.');
  } else {
    lines.push(
      r.reason === 'no_amount' ? 'У сделки нет суммы — скажи сумму, запишу доход.'
        : r.reason === 'not_won' ? 'Сделка ещё не выиграна — доход не записал.'
          : 'Сделку не нашёл — доход не записал.',
    );
  }
  return lines.join(' ');
}

/**
 * Выполняет ранее предложенное (и подтверждённое) действие. Используется
 * и из естественного «да» в оркестраторе, и из /voice/confirm-action.
 */
export async function runConfirmedAction(
  userId: string,
  action: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    // v2 H2 — batched skill action steps (from runSkillPlan Phase 2). On «да»
    // the user confirmed the money/confirm steps collected by the runner;
    // execute each through the registry (audit + zod per step). Money runs
    // ONLY here, never automatically.
    if (action === 'run_skill_actions') {
      const steps = Array.isArray((input as { steps?: unknown }).steps)
        ? ((input as { steps: Array<{ toolName: string; args: Record<string, unknown> }> }).steps)
        : [];
      const results: string[] = [];
      for (const s of steps) {
        try {
          const stepOut = (await runRegistryTool(s.toolName, s.args, { userId })) as { message?: string };
          results.push(stepOut.message ?? 'Готово.');
        } catch (stepErr) {
          console.warn(`[jarvis] skill action ${s.toolName} failed:`,
            stepErr instanceof Error ? stepErr.message : stepErr);
          results.push(`Не получилось: ${s.toolName}.`);
        }
      }
      const batchMessage = results.join('\n') || 'Готово.';
      await saveTurn(userId, '(подтверждено)', batchMessage);
      return batchMessage;
    }

    // Захват цели: «да» на предложение suggest_goal → реальная запись
    // (create-or-update + target/срок). Деньгами не двигает; commit_goal —
    // НЕ зарегистрированный tool, исполняется здесь (как run_skill_actions).
    if (action === 'commit_goal') {
      const message = await commitGoal(
        userId,
        input as unknown as CommitGoalInput,
      );
      await saveTurn(userId, '(подтверждено)', message);
      return message;
    }

    // Перегруз дня: «Подтвердить» на предложение сдвинуть график. НЕ tool
    // реестра (как commit_goal): переносы готовит только движок proposeReschedule,
    // модель их не сочиняет; applyReschedule двигает лишь свои задачи на fromDate.
    if (action === RESCHEDULE_ACTION) {
      const message = await applyReschedule(userId, input);
      await saveTurn(userId, '(подтверждено)', message);
      return message;
    }

    // Сделки: «Подтвердить» на «Записать доход … ?». НЕ tool реестра: сумму берём
    // из сделки в БД (модель её не передаёт), доход пишется ровно один раз.
    // Переспрос «какая сделка?» — не подтверждение; кнопка сюда не ведёт, но если
    // дошло — подсказываем, ничего не пишем.
    if (action === DEAL_INCOME_CHOICE) {
      // Ревью-3 N12: «Подтвердить» не съедает переспрос — возвращаем его на место.
      const hint = dealChoiceHint(input);
      await setPendingAction(userId, DEAL_INCOME_CHOICE, input, hint);
      await saveTurn(userId, '(подтверждено)', hint);
      return hint;
    }

    if (action === DEAL_INCOME_ACTION) {
      const message = await confirmDealIncome(userId, input);
      await saveTurn(userId, '(подтверждено)', message);
      return message;
    }

    // SSOT 9B.2: ВСЁ подтверждённое исполняется через РЕЕСТР
    // (аудит ToolCall + zod). legacy action-executor удалён —
    // send_telegram теперь тоже tool реестра (needsConfirm:true).
    // Аванс по сделке (X1a): обычный доход + заметка в сделку — только после «да».
    const advanceDealId = typeof input.__advanceDealId === 'string' ? input.__advanceDealId : null;
    const toolInput = advanceDealId ? { ...input } : input;
    if (advanceDealId) delete toolInput.__advanceDealId;
    const out = (await runRegistryTool(action, toolInput, { userId })) as {
      message?: string;
      error?: unknown;
    };
    let message = out.message ?? 'Готово.';
    if (advanceDealId && action === 'add_income' && out.error == null) {
      await noteDealAdvance(userId, advanceDealId, Number(input.amount)).catch((err: unknown) => {
        console.warn('[deals] advance note skipped:', err instanceof Error ? err.message : err);
      });
    }
    // Коуч по накоплениям: после подтверждённого расхода — дописать
    // строку, если трата бьёт по фин-цели (гейт+флаг внутри хука).
    if (action === 'add_expense') {
      const coach = await maybeSavingsCoachLine(userId, input);
      if (coach) message += `\n\n${coach}`;
    }
    console.log(
      `[jarvis] user=${userId} intent=${action} CONFIRMED → "${message.slice(0, 80)}"`,
    );
    await saveTurn(userId, '(подтверждено)', message);
    return message;
  } catch (err) {
    console.warn(
      `[jarvis] confirmed action failed user=${userId} intent=${action}:`,
      err instanceof Error ? err.message : err,
    );
    return 'Не получилось выполнить — попробуй ещё раз?';
  }
}

/** Замер выдуманных чисел в ответе чата (только лог, ответ не меняется). */
async function logUngroundedNumbers(userId: string, reply: string, sources: string[], since: Date): Promise<void> {
  try {
    if (userNumberClaims(reply).length === 0) return;
    const calls = await prisma.toolCall.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { inputJson: true, outputJson: true },
    });
    const bad = ungroundedClaims(reply, [...sources, JSON.stringify(calls)]);
    if (bad.length > 0) {
      console.warn(`[numguard] user=${userId} ungrounded=${bad.join(',')} tools=${calls.length} reply="${reply.slice(0, 160).replace(/\n/g, ' ')}"`);
    }
  } catch {
    /* замер — не ломает ход */
  }
}

/** Сумма денег из разбора: конечное положительное число (строка «3000» тоже). */
export function isValidMoneyAmount(v: unknown): boolean {
  const n = typeof v === 'string' ? Number(v.replace(/\s/g, '').replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n > 0;
}

export async function handleMessage(
  userId: string,
  text: string,
  // ISSUE-4: 'voice' → краткий TTS-режим в промпте. Опционально,
  // дефолт = текст (Telegram/чат не меняются — аддитивно).
  channel?: 'voice' | 'text',
  /** Потоковый ответ: куски текста основного ответа агента (голос говорит с первой фразы). */
  stream?: { onText?: (delta: string) => void },
): Promise<JarvisResponse> {
  const res = await handleMessageCore(userId, text, channel, stream);
  // Робот-эпик, Часть 2: эмоция робота — одной чистой функцией по фактам хода,
  // чтобы ни один путь (кризис, деньги, инструмент, чат) не остался без неё.
  const { turnFacts, ...out } = res;
  const pa = out.pendingAction;
  const slot = !!pa && (pa.input?.__awaitingCategory === true || pa.input?.__awaitingSource === true);
  out.emotion = emotionForTurn({
    userText: text,
    crisis: out.intent === 'safety_crisis',
    cancelled: out.intent === 'cancel_pending',
    pending: pa ? (slot ? 'slot' : 'confirm') : null,
    ...turnFacts,
  });
  // Ревью-3 N6: служебные __-ключи pending-а клиенту не отдаём (чат, голос, Telegram).
  if (pa) out.pendingAction = { action: pa.action, input: clientPendingInput(pa.input ?? {}) };
  return out;
}

async function handleMessageCore(
  userId: string,
  text: string,
  channel?: 'voice' | 'text',
  stream?: { onText?: (delta: string) => void },
): Promise<JarvisResponse> {
  // SSOT Step 7: засекаем начало хода — бейдж считаем из ToolCall,
  // созданных за этот ход (факт), а не из NLP-выдумки.
  const turnStart = new Date();
  const timing = createTurnTiming();
  // Предел на весь ход: телефон ждёт 60 с, робот укладывается раньше и честно
  // говорит «не успел», а не висит минутами (каждый вызов Claude — до 60 с ×3).
  const deadlineAt = turnStart.getTime() + TURN_DEADLINE_MS;
  const deadlineReply = async (): Promise<string> => {
    const acted = await getToolCounts(userId, turnStart)
      .then((rows) => rows.some((r) => r.count > 0))
      .catch(() => true); // не знаем — безопаснее «не повторяй сразу»
    console.warn(`[jarvis] user=${userId} ход не уложился в ${TURN_DEADLINE_MS} мс (acted=${acted})`);
    return deadlineReplyText(acted);
  };

  // ---- Phase 6 C1 SAFETY GATE (САМЫЙ ПЕРВЫЙ, до всего) ----
  // Детерминированная сеть (matchesCrisisPhrase) — instant, zero-cost,
  // гарантия recall (1b). Haiku-расширение НЕ здесь: вызов на КАЖДОЕ
  // сообщение = bot-wide latency/cost регресс; оно живёт в C3
  // emotional-пути. При кризисе: хардкод safety-ответ (style-agnostic
  // by construction — toxic физически не просочится), ОБА сообщения
  // помечаются crisis=true, ранний return — агент/стиль/инструменты
  // НЕ вызываются. Safety перебивает ВСЁ структурно, не промптом.
  if (matchesCrisisPhrase(text)) {
    // P1c (Berik): detect повторный кризис в той же сессии (~10 мин)
    // → empathy-рамка варьируется, ресурс-блок остаётся фиксированным.
    // ПРИМЕЧАНИЕ к C1(d)-инварианту: этот count — целенаправленный
    // запрос ПО crisis-флагу (не утечка content в LLM-контекст), это
    // законное исключение, документировано.
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    const recentCrisisCount = await prisma.chatMessage.count({
      where: {
        userId,
        role: 'assistant',
        crisis: true,
        createdAt: { gte: tenMinAgo },
      },
    });
    const reply = buildSafetyResponse(recentCrisisCount > 0);
    await saveTurn(userId, text, reply, true);
    return { reply, intent: 'safety_crisis' };
  }

  // ---- Фаза 1.2: ждём подтверждения предыдущего денежного действия? ----
  const pending = await peekPendingAction(userId);
  if (pending) {
    const signal = readConfirmSignal(text);
    // #189 слот-филл: pending ждёт категорию (расход)/источник (доход).
    // Следующее сообщение = значение слота (или «отмена»). Детерминир.,
    // без LLM — деньги собираются и пишутся ТОЛЬКО через FSM.
    const slot = awaitingSlot(pending);
    if (slot) {
      if (signal === 'cancel') {
        await takePendingAction(userId);
        const reply = 'Окей, отменил — ничего не записал.';
        await saveTurn(userId, text, reply);
        return { reply, intent: 'cancel_pending' };
      }
      // Ревью I-d: «получил 2 млн» → «от Серика» — тот же путь сделки, что и одной фразой.
      if (pending.action === 'add_income' && slot === 'source' && isV2DealsEnabled(userId)) {
        // Ревью-3 I1: «аванс» был в первой фразе («получил аванс 2 млн») — помним его.
        const routed = await routeDealIncome(userId, Number(pending.input.amount), text.trim(), text, {
          partial: pending.input.__partial === true,
        });
        if (routed) {
          await saveTurn(userId, text, routed.reply);
          return routed;
        }
      }
      const filled: Record<string, unknown> = {
        amount: pending.input.amount,
        [slot]: text.trim(),
      };
      const ctext = confirmationText(pending.action, filled);
      await setPendingAction(userId, pending.action, filled, ctext);
      await saveTurn(userId, text, ctext);
      return {
        reply: ctext,
        pendingAction: { action: pending.action, input: filled },
        confirmationText: ctext,
        intent: pending.action,
      };
    }
    // Ревью-3 I4: «закрыть сделку и записать доход?» → «просто доход» — обычный доход
    // той же суммы, сделку не закрываем (после «да» — заметка «аванс»).
    if (pending.action === DEAL_INCOME_ACTION && pending.input.markWon === true && JUST_INCOME_RE.test(text)) {
      const dealId = String(pending.input.dealId ?? '');
      const r = await stageAdvanceIncome(
        userId,
        Number(pending.input.amount),
        String(pending.input.__source ?? ''),
        dealId || null,
        dealId ? await dealHeadOf(userId, dealId) : null,
      );
      await saveTurn(userId, text, r.reply);
      return r;
    }
    // Ревью I-d: переспрос «какая сделка оплачена?» — «просто доход» → обычный доход
    // на ту же сумму. Ревью-3 I3: вопрос про одну сделку («это полная оплата?») —
    // «да» → предложение закрыть её на пришедшую сумму, «нет» → доход + аванс в сделке.
    // Несколько сделок — «да» ничего не решает: подсказка, вопрос держим.
    if (pending.action === DEAL_INCOME_CHOICE) {
      const amount = Number(pending.input.amount);
      const source = String(pending.input.source ?? '');
      if (JUST_INCOME_RE.test(text)) {
        await takePendingAction(userId);
        const input = { amount, source };
        const ctext = confirmationText('add_income', input);
        await setPendingAction(userId, 'add_income', input, ctext);
        await saveTurn(userId, text, ctext);
        return { reply: ctext, pendingAction: { action: 'add_income', input }, confirmationText: ctext, intent: 'add_income' };
      }
      const choiceDealId = typeof pending.input.dealId === 'string' ? pending.input.dealId : null;
      if (choiceDealId && signal === 'confirm') {
        const r = await stageFullPayment(userId, choiceDealId, amount, source);
        if (r) {
          await saveTurn(userId, text, r.reply);
          return r;
        }
      }
      if (choiceDealId && signal === 'cancel') {
        const r = await stageAdvanceIncome(userId, amount, source, choiceDealId, await dealHeadOf(userId, choiceDealId));
        await saveTurn(userId, text, r.reply);
        return r;
      }
      if (signal === 'confirm') {
        const hint = dealChoiceHint(pending.input);
        await saveTurn(userId, text, hint);
        return { reply: hint, intent: 'update_deal' };
      }
    }
    if (signal === 'confirm') {
      const p = (await takePendingAction(userId))!;
      const confirmStart = new Date();
      const reply = await runConfirmedAction(userId, p.action, p.input);
      // Ревью I-c: подтверждение могло поставить НОВЫЙ вопрос («Похоже, уже
      // записан… Записать ещё раз?») — отдаём его, чтобы были кнопки.
      const restaged = await pendingStagedSince(userId, confirmStart);
      // Переспрос (deal_income_choice) — выбор словами, без кнопок.
      if (restaged && restaged.action !== DEAL_INCOME_CHOICE) {
        return {
          reply,
          intent: p.action,
          pendingAction: { action: restaged.action, input: restaged.input },
          confirmationText: restaged.confirmationText,
        };
      }
      return { reply, intent: p.action, turnFacts: { executed: true } };
    }
    if (signal === 'cancel') {
      await takePendingAction(userId);
      const reply = 'Окей, отменил — ничего не записал.';
      await saveTurn(userId, text, reply);
      return { reply, intent: 'cancel_pending' };
    }
    // Не «да» и не «нет» — юзер сменил тему. Протухшее предложение
    // не держим, чтобы случайное «да» позже не сработало вслепую.
    await clearPendingAction(userId);
  }

  // intent-TZ фикс (аудит brain-hands 2026-06-11): «сегодня/завтра» в
  // интентах/брони = календарь ЮЗЕРА, не UTC сервера (Алматы 00–05 → вчера).
  const userTz = await getUserTimezone(userId);
  const intentP = parseIntent(text, userTz, undefined, { disabledPanels: isV2DealsEnabled(userId) ? undefined : DEALS_PANEL_OFF });
  // Контекст для агента: история, память/цели/финансы, эмоция. Не зависит от
  // намерения (кроме ритуала — подставляется из того же intentP).
  const startContext = (ip: typeof intentP) =>
    Promise.all([getRecentHistory(userId, 6), gatherAssistantContext(userId, text, ip), classifyEmotional(text)]);
  // Голос (jarvis-roadmap №5): собираем контекст ОДНОВРЕМЕННО с разбором
  // намерения — первое слово раньше. На быстрых командах (задача, трата) это
  // лишнее чтение (ничего не пишет); для текста — по-прежнему по очереди.
  const early = channel === 'voice' ? startContext(intentP) : null;
  early?.catch(() => {});
  const intent = await intentP;
  timing.mark('intent');

  // ---- Робот-эпик, Часть 3: открыть панель приложения (без ИИ) ----------
  if (intent.action === 'open_panel' && typeof intent.panel === 'string') {
    const reply = PANEL_REPLY[intent.panel] ?? 'Открываю';
    await saveTurn(userId, text, reply);
    return { reply, intent: 'open_panel', openPanel: intent.panel };
  }

  // ---- Booking: агентный flow -------------------------------------------
  if (intent.action === 'plan_travel') {
    const todayIso = civilDayRefs(userTz).today;
    const bIntent = await parseBookingIntent(text, todayIso);
    const url = buildBookingUrl(bIntent);
    const targetDate = bIntent.departDate || bIntent.checkIn || todayIso;

    // История диалога — критично: на "бюджет 100к" booking-агент должен
    // знать про какую поездку (continuity). Раньше не передавалась → агент
    // начинал заново и переспрашивал.
    const [user, events, destMemory, bHistory, purchaseFlag] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.calendarEvent.findMany({
        where: { userId, date: new Date(targetDate + 'T00:00:00Z') },
        select: { title: true, date: true, startTime: true },
        take: 10,
      }),
      bIntent.toCity || bIntent.city
        ? prisma.memory.findFirst({
            where: {
              userId,
              content: {
                contains: (bIntent.toCity || bIntent.city) as string,
                mode: 'insensitive',
              },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      getRecentHistory(userId, 8),
      // #6: уже объясняли про ручную покупку? (метка в памяти)
      prisma.memory.findFirst({
        where: { userId, tags: { has: 'purchase_explained' } },
        select: { id: true },
      }),
    ]);

    const bCtx: BookingContext = {
      userName: user?.name || 'друг',
      eventsOnDate: events.map((e) => ({
        title: e.title,
        date: e.date.toISOString().slice(0, 10),
        startTime: e.startTime,
      })),
      destinationKnown: !!destMemory,
      purchaseExplained: !!purchaseFlag,
    };

    let reply = await narrateBooking(bIntent, bCtx, url, bHistory);

    // Концьерж строит ПЛАН, а не просто отвечает: TravelPlan + дат-
    // чеклист (виза/билеты/отель/страховка/eSIM/трансфер) + события
    // вылет/возврат + чек конфликтов календаря. Анти-дубль: follow-up
    // «купи билеты» больше НЕ плодит второй план (раньше плодил, тем
    // более теперь когда conversation-путь реэнтерит plan_travel).
    // Сценарный gate (структурно, не «промпт может быть»): пока
    // tripReadiness не ready — НЕ персистим план/чеклист/события
    // (иначе «угадал курорт, не угадал человека»).
    if (
      bIntent.confidence >= 0.5 &&
      (bIntent.type === 'flight' || bIntent.type === 'hotel') &&
      (bIntent.departDate || bIntent.checkIn) &&
      tripReadiness(bIntent).ready
    ) {
      const dateFrom = (bIntent.departDate || bIntent.checkIn) as string;
      const dateToStr: string | undefined =
        bIntent.returnDate || bIntent.checkOut || undefined;
      const destName = (bIntent.toCity || bIntent.city || 'поездка').slice(0, 128);
      const depUTC = new Date(dateFrom + 'T00:00:00Z');
      const retUTC = dateToStr ? new Date(dateToStr + 'T00:00:00Z') : null;
      const todayUTC = dateOnlyUTC(todayIso);
      try {
        // Анти-дубль: уже есть planning-план в это окно на это направление?
        const existingPlan = await prisma.travelPlan.findFirst({
          where: {
            userId,
            destination: destName,
            status: 'planning',
            dateFrom: depUTC,
          },
          select: { id: true },
        });

        // №6: конфликты на даты поездки (события/несделанные задачи
        // в окне [вылет..возврат]).
        const windowEnd = retUTC ?? depUTC;
        const [conflictEvents, conflictTasks] = await Promise.all([
          prisma.calendarEvent.findMany({
            where: { userId, date: { gte: depUTC, lte: windowEnd } },
            select: { title: true, date: true },
            take: 5,
          }),
          prisma.task.findMany({
            where: {
              userId,
              completed: false,
              date: { gte: depUTC, lte: windowEnd },
            },
            select: { title: true, date: true },
            take: 5,
          }),
        ]);
        const conflicts = [
          ...conflictEvents.map((e) => ({ t: e.title, d: e.date })),
          ...conflictTasks.map((t) => ({ t: t.title, d: t.date })),
        ];
        if (conflicts.length > 0) {
          const list = conflicts
            .slice(0, 3)
            .map(
              (c) => `«${c.t}» (${c.d.toISOString().slice(0, 10)})`,
            )
            .join(', ');
          reply +=
            `\n\n⚠️ На даты поездки уже есть: ${list}` +
            (conflicts.length > 3 ? ` и ещё ${conflicts.length - 3}` : '') +
            '. Перенести или подвинуть поездку?';
        }

        if (!existingPlan) {
          // Дат-чеклист: смещения в днях ДО вылета. Прошедшие даты
          // подтягиваем на сегодня (просроченная подготовка тоже видна).
          const clamp = (offsetDays: number): Date => {
            const d = new Date(depUTC);
            d.setUTCDate(d.getUTCDate() - offsetDays);
            return d.getTime() < todayUTC.getTime() ? todayUTC : d;
          };
          const checklist: Array<{
            title: string;
            date: Date;
            priority: string;
            notes?: string;
          }> = [
            { title: `Проверить загранпаспорт и визу — ${destName}`, date: clamp(14), priority: 'critical' },
            { title: `Купить билеты — ${destName}`, date: clamp(10), priority: 'high', notes: url ?? undefined },
            { title: `Забронировать отель — ${destName}`, date: clamp(7), priority: 'high' },
            { title: `Оформить тревел-страховку — ${destName}`, date: clamp(5), priority: 'medium' },
            { title: `eSIM / SIM для ${destName}`, date: clamp(2), priority: 'medium' },
            { title: `Bolt/Grab + привязать карту, офлайн-карты — ${destName}`, date: clamp(3), priority: 'medium' },
            { title: `Снять/обменять наличные + чек-лист вещей — ${destName}`, date: clamp(2), priority: 'low' },
            { title: `Онлайн-регистрация на рейс — открой за 24ч`, date: clamp(1), priority: 'high' },
            { title: `Трансфер в аэропорт — вылет в ${destName}`, date: clamp(0), priority: 'high' },
          ];
          const remind = clamp(1);

          await prisma.$transaction(async (tx) => {
            await tx.travelPlan.create({
              data: {
                userId,
                destination: destName,
                dateFrom: depUTC,
                dateTo: retUTC,
                purpose: bIntent.rawText.slice(0, 200),
                status: 'planning',
                routes: {
                  bookingUrl: url,
                  intent: JSON.parse(JSON.stringify(bIntent)),
                },
              },
            });
            for (const item of checklist) {
              await tx.task.create({
                data: {
                  userId,
                  title: item.title.slice(0, 200),
                  category: 'personal',
                  priority: item.priority,
                  date: item.date,
                  notes: item.notes
                    ? item.notes.slice(0, 500)
                    : `JARVIS: поездка ${destName} ${dateFrom}`,
                },
              });
            }
            // Напоминание за день
            if (remind.getTime() > todayUTC.getTime()) {
              await tx.task.create({
                data: {
                  userId,
                  title: `Поездка в ${destName} завтра — проверь бронь`,
                  category: 'personal',
                  priority: 'high',
                  date: remind,
                  notes: `JARVIS: ${bIntent.rawText.slice(0, 200)}`,
                },
              });
            }
            // События поездки в календарь
            await tx.calendarEvent.create({
              data: {
                userId,
                title: `✈️ Вылет в ${destName}`,
                date: depUTC,
                description: bIntent.rawText.slice(0, 200),
                source: 'voice',
              },
            });
            if (retUTC) {
              await tx.calendarEvent.create({
                data: {
                  userId,
                  title: `✈️ Возвращение из ${destName}`,
                  date: retUTC,
                  source: 'voice',
                },
              });
            }
            await tx.memory.create({
              data: {
                userId,
                type: 'event',
                content: `Планируется поездка в ${destName} (${dateFrom}${
                  dateToStr ? '–' + dateToStr : ''
                })`,
                source: 'chat',
                tags: ['поездка', destName.toLowerCase()],
                importance: 6,
              },
            });
          });
          reply +=
            `\n\n📋 Собрал план: загранпаспорт/виза, билеты, отель, ` +
            `страховка, eSIM, Bolt/Grab+карта, наличные, онлайн-чекин, ` +
            `трансфер — задачи с датами под вылет. Вылет и возврат — ` +
            `в календаре.`;
        }
      } catch (err) {
        // план — best-effort, не валим ответ, но больше не молча
        console.warn(
          `[jarvis] travel-plan persist failed user=${userId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // #6: пометить, что про ручную покупку объяснили — чтобы в
    // следующий раз не повторять PCI-лекцию. Один раз, best-effort.
    if (!purchaseFlag) {
      // ОДНА ПАМЯТЬ (M3 Unit A): единый writeMemory, fire-and-forget.
      void writeMemory(userId, {
        type: 'preference',
        content: 'Юзеру объяснено: покупка билетов ручная (диплинк, не авто)',
        source: 'chat',
        tags: ['purchase_explained'],
        importance: 4,
      }).catch(() => {});
    }

    void trackInterests(userId, text);
    await saveTurn(userId, text, reply);
    return { reply, bookingUrl: url, intent: 'plan_travel', turnFacts: { executed: true } };
  }

  // ---- Явный диктофон ("запиши / диктофон") -----------------------------
  if (intent.action === 'start_dictation') {
    return {
      reply:
        'Говори — я слушаю. Расскажи что нужно записать, что произошло, ' +
        'про кого запомнить. Можешь голосовым или текстом.',
      intent: 'start_dictation',
    };
  }

  // ---- Исполняемые действия → реестр (runRegistryTool) ------------------
  // Фаза 1.1: соединяем мозг с executor. Раньше "отметь привычку" /
  // "добавь расход" через основной путь НЕ работали (оркестратор знал
  // только plan_travel/dictation/chat). Теперь intent-parser распознал
  // действие → выполняем его реально, а не отвечаем болтовнёй.
  const EXECUTABLE = new Set([
    'create_task',
    'complete_task',
    'complete_habit',
    'complete_multiple_habits',
    'add_expense',
    'add_income',
    'create_event',
    'send_telegram',
  ]);
  if (EXECUTABLE.has(intent.action)) {
    const input: Record<string, unknown> = { ...intent };
    delete input.action;
    if (intent.action === 'complete_task' && intent.taskTitle) {
      input.title = intent.taskTitle;
    }
    if (intent.action === 'complete_habit' && intent.habitName) {
      input.name = intent.habitName;
    }
    // ISSUE-2: send_telegram с дата-запросом («список задач»,
    // «бюджет») — РЕЗОЛВИМ тем же мозгом (он рендерит get_tasks/
    // get_calendar/get_budget в прозу) и шлём РЕЗУЛЬТАТ, а не
    // литеральную фразу. Литеральные заметки шлём как есть.
    // Резолв ДО confirm — превью покажет реальное содержимое.
    if (intent.action === 'send_telegram') {
      const raw = String(input.text ?? '').trim();
      if (isTelegramDataRequest(raw)) {
        let resolved = '';
        try {
          resolved = await runAgent({
            system:
              'Ты собираешь КРАТКОЕ сообщение для отправки ' +
              'пользователю в его Telegram по запросу ниже. Возьми ' +
              'данные через инструменты (задачи/календарь/бюджет/' +
              'план/цели). Только факты, без воды, без markdown, на ' +
              'русском. Нет данных — честно напиши «нет данных», ' +
              'НИЧЕГО не выдумывай.',
            userMessage: raw,
            webSearch: false,
            localTools: true,
            userId,
            maxTokens: 700,
            maxToolRounds: 3,
            deadlineAt,
          });
        } catch {
          resolved = '';
        }
        const body = resolved.trim();
        if (!body) {
          // ISSUE-1 класс: НЕ шлём пустое/выдуманное — честный отказ,
          // действие НЕ выполнено, pending не ставим.
          const reply =
            'Не смог собрать данные для отправки в Telegram — ' +
            'сбой на моей стороне. Ничего не отправил, попробуй ещё ' +
            'раз через минуту.';
          await saveTurn(userId, text, reply);
          return { reply, intent: 'send_telegram', turnFacts: { failed: true } };
        }
        input.text = body;
      }
    }
    // Ревью сделок B2/X1: «получил 2 млн от Ахмета» при открытой сделке с Ахметом —
    // оплата сделки, а не голый доход (иначе Income задвоится при «выиграна»).
    // Маршрутизация НИЧЕГО не пишет: сделка закрывается только на «Подтвердить».
    if (intent.action === 'add_income' && input.source != null && isV2DealsEnabled(userId)) {
      const routed = await routeDealIncome(userId, Number(input.amount), String(input.source), text);
      if (routed) {
        await saveTurn(userId, text, routed.reply);
        return routed;
      }
    }
    // Сумма из LLM-разбора бывает мусором («NaN ₸» в подтверждении, а zod
    // отказывал только после «да»). Не ставим подтверждение — переспрашиваем.
    if ((intent.action === 'add_expense' || intent.action === 'add_income') && !isValidMoneyAmount(input.amount)) {
      const q = intent.action === 'add_expense' ? 'Не расслышал сумму — сколько потратил?' : 'Не расслышал сумму — сколько получил?';
      await saveTurn(userId, text, q);
      return { reply: q, intent: intent.action, turnFacts: {} };
    }
    // #189 деньги без слота → детерминированно доспрашиваем категорию/
    // источник через FSM (сумма уже названа юзером), НЕ нарративом.
    if (intent.action === 'add_expense' && input.category == null) {
      const amount = Number(input.amount);
      const q = `На что потратил ${amount}₸? (или «отмена»)`;
      await setPendingAction(userId, 'add_expense', { amount, __awaitingCategory: true }, q);
      await saveTurn(userId, text, q);
      return {
        reply: q,
        pendingAction: { action: 'add_expense', input: { amount, __awaitingCategory: true } },
        confirmationText: q,
        intent: 'add_expense',
      };
    }
    if (intent.action === 'add_income' && input.source == null) {
      const amount = Number(input.amount);
      const q = `Откуда доход ${amount}₸? (или «отмена»)`;
      // Ревью-3 I1: «получил аванс 2 млн» → «от Серика» — частичная оплата не должна
      // потеряться между ходами (иначе слот предложит закрыть сделку выигранной).
      const slotInput: Record<string, unknown> = {
        amount,
        __awaitingSource: true,
        ...(PARTIAL_PAYMENT.test(text) ? { __partial: true } : {}),
      };
      await setPendingAction(userId, 'add_income', slotInput, q);
      await saveTurn(userId, text, q);
      return {
        reply: q,
        pendingAction: { action: 'add_income', input: { amount, __awaitingSource: true } },
        confirmationText: q,
        intent: 'add_income',
      };
    }
    // SSOT 9B.2: нужно ли подтверждение — ЕДИНСТВЕННЫЙ источник
    // правды реестр (needsConfirm на самом tool). Все EXECUTABLE
    // теперь в реестре (деньги + send_telegram → needsConfirm:true,
    // обратимые → false). legacy LEGACY_CONFIRM удалён.
    const needsConfirm = toolConfirmRequired(intent.action, input);
    // Денежное/необратимое — НЕ выполняем сразу: pending + ждём «да».
    // Обратимые (create_task/complete_habit/...) — сразу.
    if (needsConfirm) {
      const ctext = confirmationText(intent.action, input);
      await setPendingAction(userId, intent.action, input, ctext);
      console.log(
        `[jarvis] user=${userId} intent=${intent.action} PENDING (awaiting confirm)`,
      );
      await saveTurn(userId, text, ctext);
      // Факты и люди из фразы — сразу (ужин с Сериком был, даже если запись
      // траты отменят). Только память — без задач.
      if (looksPeopleWorthy(text)) {
        void captureInBackground(userId, text, String(Date.now()), { memoriesOnly: true }).catch(() => {});
      }
      return {
        reply: ctext,
        pendingAction: { action: intent.action, input },
        confirmationText: ctext,
        intent: intent.action,
      };
    }
    try {
      // SSOT: write-tools идут через РЕЕСТР (zod-валидация + аудит
      // ToolCall) — единственный путь исполнения, legacy switch
      // удалён. input уже собран и смаппен выше (до confirm-решения).
      const out = (await runRegistryTool(
        intent.action,
        input,
        { userId },
      )) as { message?: string };
      let replyText = out.message ?? 'Готово.';
      // «Не нашёл» / «какую из?» / выключено — дело НЕ сделано: не радоваться
      // как успеху (эмоция робота, бейдж). Вопрос «какую?» — без «провала».
      const didNothing = isFailedResult(out);
      const askedBack = !!(out as { ambiguous?: boolean }).ambiguous;
      // Коуч по накоплениям: тот же хук в прямой (без confirm) ветке
      // расхода — точка схождения текст/голос/фото покрыта обеими.
      if (intent.action === 'add_expense') {
        const coach = await maybeSavingsCoachLine(userId, input);
        if (coach) replyText += `\n\n${coach}`;
      }
      // Фаза 1.5: логируем решение мозга (вход → интент → действие).
      console.log(
        `[jarvis] user=${userId} intent=${intent.action} executed → "${replyText.slice(0, 80)}"`,
      );
      void trackInterests(userId, text);
      await saveTurn(userId, text, replyText);
      // Этап 4: «потратил 5000 на ужин с Сериком» — трата записана, но факты и
      // люди из фразы раньше терялись (захват жил только на пути чата).
      // Только память/люди — задачи тут не извлекаем (действие уже сделано).
      if (looksPeopleWorthy(text)) {
        void captureInBackground(userId, text, String(Date.now()), { memoriesOnly: true }).catch((err) => {
          console.warn('[captureInBackground:action] failed:', err instanceof Error ? err.message : err);
        });
      }
      // Перегруз дня: create_task положил предложение переноса в pending →
      // отдаём его, чтобы под облачком были «Подтвердить / Отмена».
      const staged = (out as { rescheduleStaged?: boolean }).rescheduleStaged
        ? await pendingStagedSince(userId, turnStart)
        : null;
      if (staged) {
        return {
          reply: replyText,
          intent: intent.action,
          turnFacts: { executed: true },
          pendingAction: { action: staged.action, input: staged.input },
          confirmationText: staged.confirmationText,
        };
      }
      return {
        reply: replyText,
        intent: intent.action,
        turnFacts: askedBack ? {} : didNothing ? { failed: true } : { executed: true },
      };
    } catch (err) {
      console.warn(
        `[jarvis] runRegistryTool failed user=${userId} intent=${intent.action}:`,
        err instanceof Error ? err.message : err,
      );
      // Этап 0: «сделал отчёт» регекс принял за привычку, а ни привычки, ни
      // задачи с таким именем нет (complete_habit ничего не записал). Это не
      // тупик — отдаём фразу агенту с инструментами: он закроет задачу,
      // запомнит событие или честно скажет, чего не нашёл.
      if (intent.action !== 'complete_habit') {
        // Падать не даём — отвечаем по-человечески, не 500.
        return {
          reply: 'Не получилось выполнить — попробуй сформулировать иначе?',
          intent: intent.action,
          turnFacts: { failed: true },
        };
      }
    }
  }

  // ---- Всё остальное: JARVIS-чат (единый промт + web search + tools) ----
  // Раньше тут жил КОРОТКИЙ inline-промт со styleHint-однострочниками —
  // он расходился с богатым assistant-personality («два мозга»). Теперь
  // ОДИН источник правды: gatherAssistantContext (полный контекст,
  // variant A — всегда) + buildJarvisPrompt (ЯДРО+СТИЛЬ+КОНТЕКСТ,
  // тот же что в fallback). goodnight/good_morning → ритуальный тон.
  // Phase 6 C3 — эмо-маршрутизация (classifyEmotional внутри startContext):
  // Safety > therapeutic > toxic. Safety уже отсёк кризис в самом верху
  // handleMessage. Здесь классифицируем НЕ-кризисный эмо vs транзакция; при
  // эмо — therapeutic-mode перебивает STYLE (включая toxic). Bias к транзакции
  // (precision > recall) защищает «запиши расход» от получения «как ты?».
  const [history, gathered, therapeuticMode] = await (early ?? startContext(Promise.resolve(intent)));
  timing.mark('ctx');

  // Phase 6 C5 — opt-out AND-gate: даже если эмо-классификатор
  // сработал, при therapeuticMode=false у юзера → ОБЫЧНЫЙ режим
  // (productivity-only). Decision: ctx.therapeuticMode (preference)
  // !== false AND classifyEmotional → THERAPEUTIC промпт. Дефолт
  // ctx.therapeuticMode = true (для legacy null-полей трактуем как
  // включено — соответствует default(true) в схеме).
  // Phase 6 P0 safety-recall hardening (Berik review 2026-05-20):
  // двухуровневый safety-gate. Phrase-net (instant, 0 latency)
  // отработал в самом верху handleMessage. Сюда message дошёл =
  // не явный кризис по списку. НО если emo-classifier сработал —
  // это эмоциональное сообщение → поднимаем Haiku-расширение
  // (classifyCrisis = phrase OR Haiku c bias-to-FP). Ловит non-
  // explicit формулировки («устал существовать», «не вижу смысла
  // продолжать», «лучше бы меня не было») — реальные люди так
  // говорят, phrase-net их пропускал. Стоимость: Haiku-вызов
  // ТОЛЬКО на эмо-сообщениях (~5%), не на каждом transactional.
  // Если Haiku говорит «да» → safety-template + crisis=true,
  // ранний return (тот же путь, что верхний phrase-гейт).
  if (therapeuticMode) {
    const haikuCrisis = await classifyCrisis(text);
    if (haikuCrisis) {
      // P1c симметрия: тот же repeat-detect, что в верхнем phrase-
      // гейте — если кризис в той же сессии (10 мин), empathy-рамка
      // варьируется. Ресурс-блок детерминирован.
      const tenMinAgo = new Date(Date.now() - 10 * 60_000);
      const recentCrisisCount = await prisma.chatMessage.count({
        where: {
          userId,
          role: 'assistant',
          crisis: true,
          createdAt: { gte: tenMinAgo },
        },
      });
      const reply = buildSafetyResponse(recentCrisisCount > 0);
      await saveTurn(userId, text, reply, true);
      return { reply, intent: 'safety_crisis' };
    }
  }

  const optIn = gathered?.context.therapeuticMode !== false;
  const finalTherapeutic = therapeuticMode && optIn;

  // Real-Time Foundation: пояс юзера в промпт ТОЛЬКО при флаге (best-effort,
  // off → undefined → байт-идентично). userTz уже резолвнут выше (тот же
  // getUserTimezone, падает в 'UTC') — без второго запроса.
  const realtimeTz = isV2RealtimeEnabled(userId) ? userTz : undefined;
  let system = gathered
    ? buildJarvisPrompt(gathered.context, {
        ...ritualOptsFor(intent, gathered.dayCompletionPercent),
        channel,
        therapeuticMode: finalTherapeutic,
        inlineNudge: isV2InlineNudgeEnabled(userId),
        goalCapture: isV2SavingsCoachEnabled(userId),
        obligationCapture: isV2ObligationsEnabled(userId),
        antiFab: isV2AntiFabEnabled(userId),
        nowTz: realtimeTz,
      })
    : 'Ты — JARVIS, дружелюбный AI-ассистент. Отвечай по-русски, кратко, без markdown.';

  // Ускорение начала ответа (jarvis-roadmap №5): дополнения к промпту — память,
  // оси, тон, цена часа/команда, навыки, нужны ли инструменты — НЕ зависят друг
  // от друга, раньше шли по очереди. Теперь — одновременно; применяем в прежнем
  // порядке (память → оси → тон → время=деньги → навык). Каждый — best-effort.
  const memoryOn = !!gathered && isV2MemoryEnabled(userId);
  const [enrich, toneSection, timeLines, skill, toolsHint] = await Promise.all([
    // v2.0 Week 5 D3 — additive memory enrichment block (best-effort, dropped
    // silently on fault → legacy prompt unaffected). Бюджет 2500мс: enrichment
    // несёт кросс-домен инсайты (runway/goal-impact/energy/relationship); внутри
    // каждый тяжёлый билдер капается своим withTimeout(1500).
    memoryOn
      ? Promise.all([
          withTimeout(fetchV2EnrichmentData(userId), 2500, null),
          withTimeout(fetchV2EnrichmentAxesSection(userId), 1500, ''),
        ]).catch((err) => {
          console.warn('[v2-enrichment] hook failed:', err);
          return [null, ''] as const;
        })
      : Promise.resolve([null, ''] as const),
    // v2 Phase B2 — lazy refresh bot traits (stale > 6h) → затем тон бота
    // (тон читает свежие traits, поэтому — цепочкой, но параллельно остальному).
    (async () => {
      if (isV2IdentityEnabled(userId)) {
        try {
          await getBotTraitsStore().refreshTraitsIfStale(userId);
        } catch (err) {
          console.warn('[orchestrator:identity-refresh] failed:', err);
        }
      }
      if (!memoryOn) return '';
      return withTimeout(fetchV2EnrichmentToneSection(userId), 1500, '').catch(() => '');
    })(),
    // Время = деньги и команда (jarvis-roadmap №3): цена часа и команда в контексте.
    gathered
      ? (async () => {
          const { getHourRate, listTeam, timeValueContextLines } = await import('./time-value.js');
          const [rate, team] = await withTimeout(Promise.all([getHourRate(userId), listTeam(userId)]), 1000, [null, []] as const);
          return timeValueContextLines(rate, [...team]);
        })().catch((err) => {
          console.warn('[time-value] context failed:', err instanceof Error ? err.message : err);
          return [] as string[];
        })
      : Promise.resolve([] as string[]),
    // v2 Phase B4 — Hermes: сохранённый навык. С confirm-шагом (деньги) —
    // детерминированный раннер (две фазы: пакет → подтверждение), без агента;
    // иначе — план навыка в промпт агенту. Best-effort: сбой → обычный агент.
    (async (): Promise<{ reply: string | null; instruction: string | null }> => {
      if (!isV2HermesEnabled(userId)) return { reply: null, instruction: null };
      try {
        const skills = await getHermesStore().activeSkills(userId);
        const matched = await routeToSkill(userId, text, skills);
        if (!matched) return { reply: null, instruction: null };
        const plan = (matched.plan as unknown as { toolName: string }[]) ?? [];
        // ASSUMPTION: all confirm-tools today use a boolean needsConfirm
        // (add-expense/add-income/send-telegram/suggest-goal). We probe with
        // {} args at routing time (before arg-resolve).
        const hasConfirm = plan.some((st) => toolConfirmRequired(st.toolName, {}));
        void getHermesStore().bumpUsage(matched.id);
        if (hasConfirm) return { reply: await runSkillPlan(userId, matched, text), instruction: null };
        const spec: SkillSpec = {
          name: matched.name,
          description: matched.description,
          triggers: matched.triggers,
          plan: matched.plan as unknown as SkillSpec['plan'],
          synthesis: matched.synthesis,
        };
        return { reply: null, instruction: buildSkillInstruction(spec) };
      } catch (err) {
        console.warn('[hermes:run-seed/runSkillPlan] failed:', err);
        return { reply: null, instruction: null };
      }
    })(),
    // Нужны ли агенту инструменты (словари + клиенты сделок) — заранее.
    needsLocalTools(userId, text).catch(() => true),
  ]);
  timing.mark('prep');

  const [v2Data, axesSection] = enrich;
  if (v2Data) system = system + '\n\n' + buildV2EnrichmentBlock(v2Data);
  if (axesSection) system = system + '\n\n' + axesSection;
  if (toneSection) {
    system = system + '\n\n' + toneSection + '\n(Стиль, который выбрал пользователь, главнее этих оттенков.)';
  }
  if (timeLines.length > 0) {
    system +=
      '\n\n' +
      timeLines.join('\n') +
      '\nДлинная встреча или дело не по уровню пользователя — можешь честно сказать, сколько это стоит его времени, и предложить отдать человеку из команды (только с его «да»).';
  }
  const skillReply: string | null = skill.reply;
  // Согласие на предложение робота без pending — с инструментами (иначе «да»
  // на «Скажи «да» — закину в план» давало выдуманное «закинул»).
  const hermesForceTools = skill.instruction !== null || acceptsRecentOffer(text, history);
  if (skill.instruction) system = system + '\n\n' + skill.instruction;

  let reply: string;
  if (skillReply !== null) {
    reply = skillReply;
  } else {
    const wantTools = hermesForceTools || toolsHint;
    try {
      reply = await runAgent({
        system,
        userMessage: text,
        history,
        webSearch: true,
        maxSearches: 3,
        maxTokens: channel === 'voice' ? VOICE_MAX_TOKENS : 900,
        deadlineAt,
        // Fix D: localTools НЕ на каждом сообщении. Для явной болтовни
        // («расскажи анекдот») они только грузят запрос (7 схем + риск
        // web_search+tools combo) без пользы. Включаем когда сообщение
        // правдоподобно требует данных/действия юзера.
        localTools: wantTools,
        userId,
        // Поток — только у основного ответа; повтор/запасные пути отдадут итог целиком.
        onText: stream?.onText
          ? (d: string) => {
              timing.firstToken();
              stream.onText?.(d);
            }
          : undefined,
        // Confirm-bridge: confirm-tool (set_balance/clear_overdue/решения…)
        // НЕ исполняется в цикле — стейджим pending + детерминир. текст,
        // запись только на «да» через peekPendingAction→runConfirmedAction.
        onConfirmTool: async (tool, args) => {
          const prompt = buildConfirmPrompt(tool, args);
          await setPendingAction(userId, tool, args, prompt);
          return prompt;
        },
      });
      // Словарь не узнал фразу, а ответ — про действие («не могу записать» /
      // выдуманное «записал») → тот же запрос с инструментами. Сбой повтора —
      // честный отказ, а не выдумка.
      if (!wantTools && replyNeedsTools(reply)) {
        console.log(`[jarvis] user=${userId} ответ без инструментов про действие → повтор с инструментами`);
        try {
          reply = await runAgent({
            system,
            userMessage: text,
            history,
            webSearch: true,
            maxSearches: 3,
            maxTokens: channel === 'voice' ? VOICE_MAX_TOKENS : 900,
            deadlineAt,
            localTools: true,
            userId,
            onConfirmTool: async (tool, args) => {
              const prompt = buildConfirmPrompt(tool, args);
              await setPendingAction(userId, tool, args, prompt);
              return prompt;
            },
          });
        } catch (retryErr) {
          if (retryErr instanceof AgentDeadlineError) throw retryErr;
          console.warn(
            `[jarvis] повтор с инструментами упал user=${userId}:`,
            retryErr instanceof Error ? retryErr.message : retryErr,
          );
          reply = DEGRADED_ACTIONABLE_REFUSAL;
        }
      }
    } catch (agentErr) {
      if (agentErr instanceof AgentDeadlineError) {
        // Время хода вышло — запасные пути (ещё вызовы Claude) не запускаем.
        reply = await deadlineReply();
      } else {
        // Fix B/A: раньше этот catch был немой — отказ агентного цикла
        // (в т.ч. возможная несовместимость web_search + custom tools)
        // был невидим. Теперь логируем И деградируем ступенчато:
        // 1) повтор БЕЗ localTools (чистый web_search-чат) — изолирует,
        //    виноват ли tool-combo, и всё равно даёт умный ответ;
        // 2) только если и это упало — не-агентный getAssistantReply.
        console.warn(
          `[jarvis] runAgent(localTools) failed user=${userId}: ${
            agentErr instanceof Error ? agentErr.message : agentErr
          } — retry without localTools`,
        );
        // ISSUE-1: если сообщение требовало инструментов юзера (данные/
        // действие — mayNeedLocalTools=true), а tool-путь упал, то
        // деградированный (web_search-only / не-агентный) ответ ЭТИХ
        // инструментов НЕ имеет и МОЖЕТ выдумать «нашёл/записал/сделал».
        // Это страховка перед 9A.8: при поломке агент-цикла честный
        // отказ, а не тихая фабрикация. Чистая болтовня/инфо (tools не
        // нужны) деградирует как раньше — web_search легитимен.
        if (wantTools) {
          // hermesForceTools: навык подсеян в system, но без localTools агент
          // не сможет вызвать его инструменты — честный отказ лучше, чем
          // ответ с «использовал инструмент X», которого в наборе нет.
          console.warn(
            `[jarvis] degraded+actionable user=${userId} → честный отказ (ISSUE-1), не фабрикуем`,
          );
          reply = DEGRADED_ACTIONABLE_REFUSAL;
        } else {
          try {
            reply = await runAgent({
              system,
              userMessage: text,
              history,
              webSearch: true,
              maxSearches: 3,
              maxTokens: channel === 'voice' ? VOICE_MAX_TOKENS : 900,
              deadlineAt,
            });
            console.warn(
              `[jarvis] degraded OK user=${userId}: web_search-only ответ сработал ` +
                `(сообщение не требовало tools — фабрикации нет)`,
            );
          } catch (webErr) {
            console.warn(
              `[jarvis] runAgent(web_search-only) тоже упал user=${userId}: ${
                webErr instanceof Error ? webErr.message : webErr
              } — fallback getAssistantReply`,
            );
            if (webErr instanceof AgentDeadlineError) {
              reply = await deadlineReply();
            } else {
              const r = await getAssistantReply(userId, text, finalTherapeutic);
              reply = r.text;
            }
          }
        }
      }
    }
  }

  console.log(timing.line({ user: userId, ch: channel ?? 'text', tools: toolsHint ? 1 : 0 }));

  // Числа о делах пользователя («осталось 12 000 ₸», «3 задачи»), которых нет
  // ни в контексте, ни в словах пользователя, ни в инструментах хода, —
  // пока только пишем в лог (замер перед тем, как исправлять ответ). В фоне.
  void logUngroundedNumbers(userId, reply, [system, text, ...history.map((h) => h.content)], turnStart);

  // Фоновое извлечение задач/фактов (ambient-фича). Возврат НЕ
  // используем для бейджа — SSOT Step 7: бейдж только из аудита.
  // ISSUE-8: гейтим — вопросы/болтовня/короткие реплики НЕ
  // извлекаем (раньше «как мне начать бегать?» плодило мусорную
  // задачу). Осмысленный ambient-capture («купи продукты», «надо
  // позвонить врачу») сохраняется.
  if (looksCaptureWorthy(text)) {
    // 1.4 (AUDIT-2026-06): fire-and-forget. Раньше await блокировал ответ
    // на +1 Sonnet-вызов (extractFromTranscript) на «важных» сообщениях.
    // Результат не используется; capture идёт в фоне. .catch — чтобы не
    // было unhandled rejection при сбое.
    // Агент в этом ходу уже создал задачу (create_task) — фон извлекает
    // только память/людей, иначе та же задача появлялась второй раз.
    const agentCreatedTask = await getToolCounts(userId, turnStart)
      .then((rows) => rows.some((r) => r.toolName === 'create_task' && r.count > 0))
      .catch(() => false);
    void captureInBackground(userId, text, String(Date.now()), { memoriesOnly: agentCreatedTask }).catch((err) => {
      console.warn(
        '[captureInBackground] failed:',
        err instanceof Error ? err.message : err,
      );
    });
  } else if (looksMemoryWorthy(text) || looksPeopleWorthy(text)) {
    // Болтовня с фактами о себе/близких: задачи не создаём, факты и людей — да.
    void captureInBackground(userId, text, String(Date.now()), { memoriesOnly: true }).catch((err) => {
      console.warn('[captureInBackground:memories] failed:', err instanceof Error ? err.message : err);
    });
  }

  // Трекинг интересов (спорт/финансы/...) — fire-and-forget, не ждём.
  void trackInterests(userId, text);

  // v2 Phase B1 — post-process content rules (Gate 1: step-count)
  if (isV2AxesEnabledFlag(userId)) {
    try {
      const axes = await getUserAxesStore().getAxes(userId);
      const stepCount = extractStepCount(reply);
      const gate1 = shouldForceOneStep(axes, stepCount);
      if (gate1.force) {
        // Dev-only signal — MUST stay server-side. Do NOT create a
        // user-facing Insight and do NOT prepend a marker to `reply`:
        // those leaked internal diagnostics straight to the user (the
        // "⚠️ Gate 1 rule fired" Telegram message + the "(gate-1: 1-step)"
        // reply prefix). Detection is kept as the hook; real 1-step
        // enforcement (reply regeneration under a step constraint) is a
        // deliberate follow-up, not a UI-text stub.
        console.log(`[axes:gate1] ${gate1.reason}`);
      }
    } catch (err) {
      console.warn('[axes:postprocess] failed:', err);
    }
  }

  await saveTurn(userId, text, reply);

  // Бейдж = реальные исполненные за ход инструменты (ToolCall).
  // Только успешные (getToolCounts фильтрует error=null). 0 → нет бейджа.
  const acted = (await getToolCounts(userId, turnStart)).reduce(
    (s, r) => s + r.count,
    0,
  );

  // voice-one-brain (ревью S2): агент мог поставить pending ВНУТРИ цикла
  // (delete/edit_expense, set_balance, suggest_goal…). Раньше ход его не
  // возвращал → мобилка не показывала «Подтвердить / Отмена», юзер слышал
  // «Подтверди…» и должен был догадаться сказать «да». Отдаём только pending
  // ЭТОГО хода (не протухшее старое предложение).
  const staged = await pendingStagedSince(userId, turnStart);

  return {
    reply,
    auditedActions: acted,
    intent: intent.action,
    turnFacts: {
      emotional: finalTherapeutic,
      style: gathered?.context.assistantStyle ?? null,
      executed: acted > 0 && !staged,
    },
    ...(staged
      ? {
          pendingAction: { action: staged.action, input: staged.input },
          confirmationText: staged.confirmationText,
        }
      : {}),
  };
}
