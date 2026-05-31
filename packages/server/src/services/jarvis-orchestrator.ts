import { prisma } from '../lib/prisma.js';
import { parseIntent } from '../ai/intent-parser.js';
import {
  getAssistantReply,
  gatherAssistantContext,
  ritualOptsFor,
} from './assistant-service.js';
import { buildJarvisPrompt } from '../ai/jarvis-prompt.js';
import { extractFromTranscript } from './dictation-service.js';
import {
  parseBookingIntent,
  buildBookingUrl,
  narrateBooking,
  tripReadiness,
  type BookingContext,
} from './smart-booking.js';
import { runAgent } from './claude-agent.js';
import { matchesCrisisPhrase, classifyCrisis } from './safety-classifier.js';
import { buildSafetyResponse } from './safety-response.js';
import { classifyEmotional } from './emotional-classifier.js';
import { isPlannerIntent } from './planner-service.js';
import { captureMemory } from './memory-service.js';
import { trackInterests } from './interest-service.js';
import { runRegistryTool, toolConfirmRequired } from '../tools/index.js';
import { getToolCounts } from './tool-audit.js';
import {
  peekPendingAction,
  takePendingAction,
  setPendingAction,
  clearPendingAction,
  readConfirmSignal,
} from './pending-actions.js';
import { isV2MemoryEnabled } from '../lib/feature-flags.js';
import { captureV2InBackground } from './v2-capture.js';
import {
  buildV2EnrichmentBlock,
  fetchV2EnrichmentData,
} from './v2-enrichment.js';
import { shouldForceOneStep, extractStepCount } from './user-axes/content-rules.js';
import { getUserAxesStore } from './user-axes/index.js';
import { isV2AxesEnabled as isV2AxesEnabledFlag } from '../lib/feature-flags.js';
import { getBotTraitsStore } from './bot-traits/index.js';
import { isV2IdentityEnabled } from '../lib/feature-flags.js';
import { isV2HermesEnabled } from '../lib/feature-flags.js';
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
}

/**
 * ISSUE-8 gate: стоит ли вообще NLP-извлекать задачи/факты из этой
 * реплики. Чистая детерминированная эвристика (без LLM/БД). Цель —
 * убрать мусор (вопросы/болтовня → фейковые задачи), сохранив
 * осмысленный ambient-capture («купи продукты», «надо позвонить»).
 * Лучше пропустить сомнительное (не плодить мусор), чем извлечь.
 */
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
): Promise<{ tasks: number; memories: number }> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    const extracted = await extractFromTranscript(text, user?.name || 'друг');
    let tasks = 0;
    let memories = 0;
    if (extracted.tasks.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const t of extracted.tasks) {
          await tx.task.create({
            data: {
              userId,
              title: t.title.slice(0, 500),
              category: (t.category || 'personal').slice(0, 32),
              priority: (t.priority || 'medium').slice(0, 32),
              date: new Date(
                (t.date || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z',
              ),
              time: t.time?.slice(0, 8) ?? null,
              notes: t.notes?.slice(0, 2000) ?? null,
            },
          });
          tasks++;
        }
      });
    }
    // Память — вне task-транзакции: captureMemory дедуплицирует
    // (Фаза 2.2), а это собственные запросы — в tx неуместно. Память
    // best-effort, с задачами не атомарна по смыслу.
    for (const m of extracted.memories) {
      await captureMemory(userId, {
        type: m.type,
        content: m.content,
        details: m.details ?? null,
        source: 'chat',
        tags: m.tags,
        importance: m.importance,
      });
      memories++;
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
        { userId, role: 'user', content: userText.slice(0, 4000), crisis },
        {
          userId,
          role: 'assistant',
          content: assistantText.slice(0, 4000),
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
const TOOL_HINTS =
  /(задач|календар|встреч|событи|бюджет|потрат|расход|доход|привычк|напомн|почт|письм|gmail|расписан|план(?!ета)|поездк|цел[ьия]|сколько|что у меня|что сегодня|что по|добав|созда|отмет|перенес|свобод|кто так|телефон|контакт|номер|что я говорил про|помнишь про|погод|надеть|надену|одет|оденусь|выезж|вылет|лечу|бронь|билет|когда у меня|навык)/i;

/**
 * ISSUE-1: честный отказ когда tool-путь упал, а запрос требовал
 * инструментов. Лучше «не смог», чем тихая выдумка «нашёл/записал».
 */
export const DEGRADED_ACTIONABLE_REFUSAL =
  'Извини, сейчас не получается это выполнить — сбой на моей стороне, ' +
  'не у тебя. Действие НЕ выполнено. Попробуй, пожалуйста, ещё раз через минуту.';

export function mayNeedLocalTools(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false; // короткие реплики = болтовня
  return TOOL_HINTS.test(t);
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
  return 'Подтверди действие — выполню.';
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
    // SSOT 9B.2: ВСЁ подтверждённое исполняется через РЕЕСТР
    // (аудит ToolCall + zod). legacy action-executor удалён —
    // send_telegram теперь тоже tool реестра (needsConfirm:true).
    const out = (await runRegistryTool(action, input, { userId })) as {
      message?: string;
    };
    const message = out.message ?? 'Готово.';
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

export async function handleMessage(
  userId: string,
  text: string,
  // ISSUE-4: 'voice' → краткий TTS-режим в промпте. Опционально,
  // дефолт = текст (Telegram/чат не меняются — аддитивно).
  channel?: 'voice' | 'text',
): Promise<JarvisResponse> {
  // SSOT Step 7: засекаем начало хода — бейдж считаем из ToolCall,
  // созданных за этот ход (факт), а не из NLP-выдумки.
  const turnStart = new Date();

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
    if (signal === 'confirm') {
      const p = (await takePendingAction(userId))!;
      const reply = await runConfirmedAction(userId, p.action, p.input);
      return { reply, intent: p.action };
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

  const intent = await parseIntent(text);

  // ---- Booking: агентный flow -------------------------------------------
  if (intent.action === 'plan_travel') {
    const todayIso = new Date().toISOString().slice(0, 10);
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
      const todayUTC = new Date(
        new Date().toISOString().slice(0, 10) + 'T00:00:00Z',
      );
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
      void captureMemory(userId, {
        type: 'preference',
        content: 'Юзеру объяснено: покупка билетов ручная (диплинк, не авто)',
        source: 'chat',
        tags: ['purchase_explained'],
        importance: 4,
      }).catch(() => {});
    }

    void trackInterests(userId, text);
    await saveTurn(userId, text, reply);
    return { reply, bookingUrl: url, intent: 'plan_travel' };
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
          return { reply, intent: 'send_telegram' };
        }
        input.text = body;
      }
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
      const replyText = out.message ?? 'Готово.';
      // Фаза 1.5: логируем решение мозга (вход → интент → действие).
      console.log(
        `[jarvis] user=${userId} intent=${intent.action} executed → "${replyText.slice(0, 80)}"`,
      );
      void trackInterests(userId, text);
      await saveTurn(userId, text, replyText);
      return { reply: replyText, intent: intent.action };
    } catch (err) {
      console.warn(
        `[jarvis] runRegistryTool failed user=${userId} intent=${intent.action}:`,
        err instanceof Error ? err.message : err,
      );
      // Падать не даём — отвечаем по-человечески, не 500.
      return {
        reply: 'Не получилось выполнить — попробуй сформулировать иначе?',
        intent: intent.action,
      };
    }
  }

  // ---- Всё остальное: JARVIS-чат (единый промт + web search + tools) ----
  // Раньше тут жил КОРОТКИЙ inline-промт со styleHint-однострочниками —
  // он расходился с богатым assistant-personality («два мозга»). Теперь
  // ОДИН источник правды: gatherAssistantContext (полный контекст,
  // variant A — всегда) + buildJarvisPrompt (ЯДРО+СТИЛЬ+КОНТЕКСТ,
  // тот же что в fallback). goodnight/good_morning → ритуальный тон.
  const [history, gathered, therapeuticMode] = await Promise.all([
    getRecentHistory(userId, 6),
    gatherAssistantContext(userId, text, intent),
    // Phase 6 C3 — эмо-маршрутизация: Safety > therapeutic > toxic.
    // Safety уже отсёк кризис в самом верху handleMessage. Здесь
    // классифицируем НЕ-кризисный эмо vs транзакция; при эмо —
    // therapeutic-mode перебивает STYLE (включая toxic). Bias к
    // транзакции (precision > recall) защищает «запиши расход» от
    // получения «как ты?» (провал-инвариант спеки #4).
    classifyEmotional(text),
  ]);

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

  // v2 Phase B2 — lazy refresh bot traits (recompute if stale > 6h).
  // Cheap (pure compute + small queries); persists into BotIdentity.traits
  // so the enrichment block's getTraits sees fresh values.
  if (isV2IdentityEnabled(userId)) {
    try {
      await getBotTraitsStore().refreshTraitsIfStale(userId);
    } catch (err) {
      console.warn('[orchestrator:identity-refresh] failed:', err);
    }
  }

  let system = gathered
    ? buildJarvisPrompt(gathered.context, {
        ...ritualOptsFor(intent, gathered.dayCompletionPercent),
        channel,
        therapeuticMode: finalTherapeutic,
      })
    : 'Ты — JARVIS, дружелюбный AI-ассистент. Отвечай по-русски, кратко, без markdown.';

  // v2.0 Week 5 D3 — additive memory enrichment block (best-effort,
  // dropped silently on fault → legacy prompt unaffected).
  if (gathered && isV2MemoryEnabled(userId)) {
    try {
      const v2Data = await fetchV2EnrichmentData(userId);
      if (v2Data) {
        system = system + '\n\n' + buildV2EnrichmentBlock(v2Data);
      }
    } catch (err) {
      console.warn('[v2-enrichment] hook failed:', err);
    }
  }

  // v2 Phase B4 — Hermes: if the message routes to a saved skill, seed the
  // agent turn with the skill's plan. The existing loop executes it, so
  // money/write steps still hit their normal confirm gates. Best-effort.
  // H2 composition routing: skills whose plan contains a confirm step
  // (money/irreversible) run through the deterministic runSkillPlan runner
  // (two-phase: batch → confirm); all other skills seed the agent loop as
  // before (zero regression).
  let hermesForceTools = false;
  let skillReply: string | null = null;
  if (isV2HermesEnabled(userId)) {
    try {
      const skills = await getHermesStore().activeSkills(userId);
      const matched = await routeToSkill(userId, text, skills);
      if (matched) {
        const plan = (matched.plan as unknown as { toolName: string }[]) ?? [];
        // ASSUMPTION: all confirm-tools today use a boolean needsConfirm
        // (add-expense/add-income/send-telegram/suggest-goal). We probe with
        // {} args at routing time (before arg-resolve). If a tool ever uses an
        // input-DEPENDENT needsConfirm lambda, this under-detects → re-evaluate
        // hasConfirm after resolveSkillArgs (or add availableToAgent decoupling).
        const hasConfirm = plan.some((s) => toolConfirmRequired(s.toolName, {}));
        if (hasConfirm) {
          // v2 H2 — action skill: deterministic two-phase runner (money steps
          // batch into a confirm); bypasses the agent loop.
          skillReply = await runSkillPlan(userId, matched, text);
          void getHermesStore().bumpUsage(matched.id);
        } else {
          // read/write-non-money skill: existing agent-loop seed (unchanged).
          const spec: SkillSpec = {
            name: matched.name,
            description: matched.description,
            triggers: matched.triggers,
            plan: matched.plan as unknown as SkillSpec['plan'],
            synthesis: matched.synthesis,
          };
          system = system + '\n\n' + buildSkillInstruction(spec);
          hermesForceTools = true;
          void getHermesStore().bumpUsage(matched.id);
        }
      }
    } catch (err) {
      // Guards routeToSkill + runSkillPlan + buildSkillInstruction. On any
      // throw, skillReply stays null + hermesForceTools false → clean
      // fall-through to the normal agent loop (best-effort degradation).
      console.warn('[hermes:run-seed/runSkillPlan] failed:', err);
    }
  }

  let reply: string;
  if (skillReply !== null) {
    reply = skillReply;
  } else {
    try {
      reply = await runAgent({
        system,
        userMessage: text,
        history,
        webSearch: true,
        maxSearches: 3,
        maxTokens: 900,
        // Fix D: localTools НЕ на каждом сообщении. Для явной болтовни
        // («расскажи анекдот») они только грузят запрос (7 схем + риск
        // web_search+tools combo) без пользы. Включаем когда сообщение
        // правдоподобно требует данных/действия юзера.
        localTools: hermesForceTools || mayNeedLocalTools(text),
        userId,
      });
    } catch (agentErr) {
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
      if (mayNeedLocalTools(text) || hermesForceTools) {
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
            maxTokens: 900,
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
          const r = await getAssistantReply(userId, text, finalTherapeutic);
          reply = r.text;
        }
      }
    }
  }

  // Фоновое извлечение задач/фактов (ambient-фича). Возврат НЕ
  // используем для бейджа — SSOT Step 7: бейдж только из аудита.
  // ISSUE-8: гейтим — вопросы/болтовня/короткие реплики НЕ
  // извлекаем (раньше «как мне начать бегать?» плодило мусорную
  // задачу). Осмысленный ambient-capture («купи продукты», «надо
  // позвонить врачу») сохраняется.
  if (looksCaptureWorthy(text)) {
    await captureInBackground(userId, text, String(Date.now()));
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

  return {
    reply,
    auditedActions: acted,
    intent: intent.action,
  };
}
