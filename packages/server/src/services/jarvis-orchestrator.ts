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
import { captureMemory } from './memory-service.js';
import { trackInterests } from './interest-service.js';
import { executeAction } from './action-executor.js';
import { runRegistryTool, registry, toolConfirmRequired } from '../tools/index.js';
import { getToolCounts } from './tool-audit.js';
import {
  peekPendingAction,
  takePendingAction,
  setPendingAction,
  clearPendingAction,
  readConfirmSignal,
} from './pending-actions.js';

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
 * Фоновое извлечение задач/фактов из сообщения. Не блокирует ответ.
 * Так "купи продукты" станет задачей даже когда основной режим — чат.
 */
async function captureInBackground(
  userId: string,
  text: string,
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
    where: { userId },
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
): Promise<void> {
  try {
    await prisma.chatMessage.createMany({
      data: [
        { userId, role: 'user', content: userText.slice(0, 4000) },
        { userId, role: 'assistant', content: assistantText.slice(0, 4000) },
      ],
    });
  } catch {
    /* история — не критично, не валим запрос */
  }
}

/** Денежные/необратимые — требуют явного «да» перед выполнением. */
// SSOT Step 6: confirm-решение — производное от реестра (needsConfirm
// живёт на tool). Здесь остаётся ТОЛЬКО legacy, ещё не в реестре:
// send_telegram (мигрирует/убирается на Шаге 9). add_expense/
// add_income больше НЕ тут — их гейт на самом инструменте.
const LEGACY_CONFIRM = new Set(['send_telegram']);

// Fix D: эвристика «сообщению нужны локальные инструменты». Без \b —
// кириллические границы в JS не работают; ловим по подстрокам корней.
const TOOL_HINTS =
  /(задач|календар|встреч|событи|бюджет|потрат|расход|доход|привычк|напомн|почт|письм|gmail|расписан|план(?!ета)|поездк|цел[ьия]|сколько|что у меня|что сегодня|что по|добав|созда|отмет|перенес|свобод|кто так|телефон|контакт|номер|что я говорил про|помнишь про|погод|надеть|надену|одет|оденусь|выезж|вылет|лечу|бронь|билет|когда у меня)/i;

export function mayNeedLocalTools(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false; // короткие реплики = болтовня
  return TOOL_HINTS.test(t);
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
    // SSOT Step 6: подтверждённое денежное действие исполняется
    // через РЕЕСТР (аудит ToolCall + zod), а не legacy switch.
    // send_telegram ещё не в реестре → legacy executeAction.
    let message: string;
    if (registry.has(action)) {
      const out = (await runRegistryTool(action, input, { userId })) as {
        message?: string;
      };
      message = out.message ?? 'Готово.';
    } else {
      const r = await executeAction(action, input, userId);
      message = r.message;
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

export async function handleMessage(
  userId: string,
  text: string,
): Promise<JarvisResponse> {
  // SSOT Step 7: засекаем начало хода — бейдж считаем из ToolCall,
  // созданных за этот ход (факт), а не из NLP-выдумки.
  const turnStart = new Date();
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

  // ---- Исполняемые действия → action-executor ---------------------------
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
    // SSOT Step 6: нужно ли подтверждение — спрашиваем у РЕЕСТРА
    // (needsConfirm на самом tool). Только не-реестровый legacy
    // (send_telegram) решается локальным набором. Деньги
    // (add_expense/add_income) гейтятся своим needsConfirm:true.
    const needsConfirm = registry.has(intent.action)
      ? toolConfirmRequired(intent.action, input)
      : LEGACY_CONFIRM.has(intent.action);
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
      // SSOT Шаг 5: write-tools идут через РЕЕСТР (zod-валидация +
      // аудит ToolCall), не через legacy action-executor switch.
      // input уже собран и смаппен выше (до confirm-решения).
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
  const [history, gathered] = await Promise.all([
    getRecentHistory(userId, 6),
    gatherAssistantContext(userId, text, intent),
  ]);

  const system = gathered
    ? buildJarvisPrompt(
        gathered.context,
        ritualOptsFor(intent, gathered.dayCompletionPercent),
      )
    : // юзер не найден в БД — крайне маловероятно (есть auth), но не падаем
      'Ты — JARVIS, дружелюбный AI-ассистент. Отвечай по-русски, кратко, без markdown.';

  let reply: string;
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
      localTools: mayNeedLocalTools(text),
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
          `(значит проблема именно в localTools-комбинации)`,
      );
    } catch (webErr) {
      console.warn(
        `[jarvis] runAgent(web_search-only) тоже упал user=${userId}: ${
          webErr instanceof Error ? webErr.message : webErr
        } — fallback getAssistantReply`,
      );
      const r = await getAssistantReply(userId, text);
      reply = r.text;
    }
  }

  // Фоновое извлечение задач/фактов (ambient-фича). Возврат НЕ
  // используем для бейджа — SSOT Step 7: бейдж только из аудита.
  await captureInBackground(userId, text);

  // Трекинг интересов (спорт/финансы/...) — fire-and-forget, не ждём.
  void trackInterests(userId, text);

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
