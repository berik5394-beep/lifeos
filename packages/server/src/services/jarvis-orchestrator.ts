import { prisma } from '../lib/prisma.js';
import { parseIntent } from '../ai/intent-parser.js';
import { getAssistantReply } from './assistant-service.js';
import { extractFromTranscript } from './dictation-service.js';
import {
  parseBookingIntent,
  buildBookingUrl,
  narrateBooking,
  type BookingContext,
} from './smart-booking.js';
import { runAgent } from './claude-agent.js';
import { getRelevantMemories, captureMemory } from './memory-service.js';
import { trackInterests } from './interest-service.js';
import { executeAction } from './action-executor.js';
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
  /** Что извлекли в фоне (для показа "записал N задач") */
  capturedTasks?: number;
  capturedMemories?: number;
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
const NEEDS_CONFIRM = new Set(['add_expense', 'add_income']);

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
    const r = await executeAction(action, input, userId);
    console.log(
      `[jarvis] user=${userId} intent=${action} CONFIRMED → "${r.message.slice(0, 80)}"`,
    );
    await saveTurn(userId, '(подтверждено)', r.message);
    return r.message;
  } catch (err) {
    console.warn(
      `[jarvis] confirmed executeAction failed user=${userId} intent=${action}:`,
      err instanceof Error ? err.message : err,
    );
    return 'Не получилось выполнить — попробуй ещё раз?';
  }
}

export async function handleMessage(
  userId: string,
  text: string,
): Promise<JarvisResponse> {
  // ---- Фаза 1.2: ждём подтверждения предыдущего денежного действия? ----
  const pending = peekPendingAction(userId);
  if (pending) {
    const signal = readConfirmSignal(text);
    if (signal === 'confirm') {
      const p = takePendingAction(userId)!;
      const reply = await runConfirmedAction(userId, p.action, p.input);
      return { reply, intent: p.action };
    }
    if (signal === 'cancel') {
      takePendingAction(userId);
      const reply = 'Окей, отменил — ничего не записал.';
      await saveTurn(userId, text, reply);
      return { reply, intent: 'cancel_pending' };
    }
    // Не «да» и не «нет» — юзер сменил тему. Протухшее предложение
    // не держим, чтобы случайное «да» позже не сработало вслепую.
    clearPendingAction(userId);
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
    const [user, events, destMemory, bHistory] = await Promise.all([
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
    ]);

    const bCtx: BookingContext = {
      userName: user?.name || 'друг',
      eventsOnDate: events.map((e) => ({
        title: e.title,
        date: e.date.toISOString().slice(0, 10),
        startTime: e.startTime,
      })),
      destinationKnown: !!destMemory,
    };

    const reply = await narrateBooking(bIntent, bCtx, url, bHistory);

    // Сохраняем/обновляем план поездки + ставим напоминание, чтобы JARVIS
    // вёл поездку до конца, а не просто ответил один раз.
    if (
      bIntent.confidence >= 0.5 &&
      (bIntent.type === 'flight' || bIntent.type === 'hotel') &&
      (bIntent.departDate || bIntent.checkIn)
    ) {
      const dateFrom = (bIntent.departDate || bIntent.checkIn) as string;
      const destName = (bIntent.toCity || bIntent.city || 'поездка').slice(0, 128);
      try {
        await prisma.$transaction(async (tx) => {
          await tx.travelPlan.create({
            data: {
              userId,
              destination: destName,
              dateFrom: new Date(dateFrom + 'T00:00:00Z'),
              dateTo:
                bIntent.returnDate || bIntent.checkOut
                  ? new Date(
                      ((bIntent.returnDate || bIntent.checkOut) as string) +
                        'T00:00:00Z',
                    )
                  : null,
              purpose: bIntent.rawText.slice(0, 200),
              status: 'planning',
              routes: { bookingUrl: url, intent: JSON.parse(JSON.stringify(bIntent)) },
            },
          });
          // Напоминание за день до поездки
          const remindDate = new Date(dateFrom + 'T00:00:00Z');
          remindDate.setDate(remindDate.getDate() - 1);
          if (remindDate.getTime() > Date.now()) {
            await tx.task.create({
              data: {
                userId,
                title: `Поездка в ${destName} завтра — проверь бронь`,
                category: 'personal',
                priority: 'high',
                date: remindDate,
                notes: `JARVIS: ${bIntent.rawText.slice(0, 200)}`,
              },
            });
          }
          // Запоминаем сам факт поездки
          await tx.memory.create({
            data: {
              userId,
              type: 'event',
              content: `Планируется поездка в ${destName} (${dateFrom})`,
              source: 'chat',
              tags: ['поездка', destName.toLowerCase()],
              importance: 6,
            },
          });
        });
      } catch {
        /* план/напоминание — best-effort, не валим ответ */
      }
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
  ]);
  if (EXECUTABLE.has(intent.action)) {
    // Фаза 1.2: денежное действие — НЕ выполняем сразу. Предлагаем,
    // сохраняем как pending, ждём «да» (или кнопку в приложении).
    // Безопасные (create_task/complete_habit/...) — выполняем сразу,
    // они обратимы.
    if (NEEDS_CONFIRM.has(intent.action)) {
      const input: Record<string, unknown> = { ...intent };
      delete input.action;
      const ctext = confirmationText(intent.action, input);
      setPendingAction(userId, intent.action, input, ctext);
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
      let replyText: string;
      if (intent.action === 'complete_multiple_habits') {
        // executor ждёт habitIds, парсер даёт имена → резолвим через
        // complete_habit по имени в цикле (executor сам ищет по name).
        const names = (intent.habitNames as string[] | undefined) ?? [];
        const msgs: string[] = [];
        for (const name of names) {
          const r = await executeAction('complete_habit', { name }, userId);
          msgs.push(r.message);
        }
        replyText = msgs.length ? msgs.join('\n') : 'Не понял какие привычки отметить.';
      } else {
        // Маппинг полей intent-parser → executeAction input.
        const input: Record<string, unknown> = { ...intent };
        delete input.action;
        if (intent.action === 'complete_task' && intent.taskTitle) {
          input.title = intent.taskTitle;
        }
        if (intent.action === 'complete_habit' && intent.habitName) {
          input.name = intent.habitName;
        }
        const r = await executeAction(intent.action, input, userId);
        replyText = r.message;
      }
      // Фаза 1.5: логируем решение мозга (вход → интент → действие).
      console.log(
        `[jarvis] user=${userId} intent=${intent.action} executed → "${replyText.slice(0, 80)}"`,
      );
      void trackInterests(userId, text);
      await saveTurn(userId, text, replyText);
      return { reply: replyText, intent: intent.action };
    } catch (err) {
      console.warn(
        `[jarvis] executeAction failed user=${userId} intent=${intent.action}:`,
        err instanceof Error ? err.message : err,
      );
      // Падать не даём — отвечаем по-человечески, не 500.
      return {
        reply: 'Не получилось выполнить — попробуй сформулировать иначе?',
        intent: intent.action,
      };
    }
  }

  // ---- Всё остальное: JARVIS-чат (web search + память + история) --------
  const [history, memories, user] = await Promise.all([
    getRecentHistory(userId, 6),
    getRelevantMemories(userId, text, 15),
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, assistantStyle: true },
    }),
  ]);

  const memoryBlock =
    memories.length > 0
      ? '\n\nЧто ты помнишь о юзере:\n' +
        memories.map((m) => `- ${m.content}`).join('\n')
      : '';

  const styleHint =
    user?.assistantStyle === 'toxic'
      ? 'Стиль: саркастичный, подкалывающий, но за этим — забота.'
      : user?.assistantStyle === 'strict'
        ? 'Стиль: строгий, требовательный, без воды.'
        : user?.assistantStyle === 'calm'
          ? 'Стиль: спокойный, мудрый, размеренный.'
          : 'Стиль: тёплый, дружелюбный, поддерживающий.';

  const system = `Ты — JARVIS, личный AI-ассистент пользователя ${user?.name || 'друга'}. Ты ДУМАЕШЬ и ДЕЙСТВУЕШЬ, а не просто болтаешь.

${styleHint}

Юзер из Казахстана. По умолчанию: валюта — тенге (₸), город — Алматы (если не указан другой). Цены/расстояния/сервисы давай в казахстанском контексте, не российском. Рубли только если юзер явно про Россию.

Что ты УМЕЕШЬ делать (не просто советовать — реально выполнять, юзеру достаточно сказать):
- Создавать задачи и отмечать их выполненными
- Отмечать привычки (одну или сразу несколько)
- Записывать расходы и доходы (с подтверждением — спросишь «записать?»)
- Создавать встречи/события в календаре
- Подбирать и бронировать перелёты/отели/такси (консьерж)
- Давать сводку дня/недели, финансовый анализ бюджета
- Помнить факты о юзере и его людях, искать по памяти
Поэтому если из разговора видно конкретное действие — предлагай его сделать сам словами юзера ("хочешь, отмечу привычку «бег»?", "записать это как расход 3000 ₸?", "добавить в задачи на завтра?"), а не объясняй как сделать вручную.

Правила:
1. Если вопрос требует актуальной информации (цены, новости, погода, факты, "что лучше купить", "сколько стоит") — ОБЯЗАТЕЛЬНО используй web search. Не отвечай "не знаю" или по устаревшим данным.
2. Отвечай конкретно и по делу. Живая речь, без канцелярита и markdown-списков.
3. Будь проактивным: если видишь что можешь помочь дальше — предложи или спроси ("хочешь добавлю в задачи?", "напомнить?"). Ты МОЖЕШЬ это выполнить — см. список выше.
4. Помни контекст из истории диалога и из памяти о юзере (ниже). Ссылайся на это естественно.
5. Коротко: 2-6 предложений обычно достаточно. Глубоко — только если просят разобраться.${memoryBlock}`;

  let reply: string;
  try {
    reply = await runAgent({
      system,
      userMessage: text,
      history,
      webSearch: true,
      maxSearches: 3,
      maxTokens: 900,
    });
  } catch {
    // Fallback на не-агентный ответ если web-search/Claude упал
    const r = await getAssistantReply(userId, text);
    reply = r.text;
  }

  // Фоновое извлечение задач/фактов — не блокируем ответ.
  const captured = await captureInBackground(userId, text);

  // Трекинг интересов (спорт/финансы/...) — fire-and-forget, не ждём.
  void trackInterests(userId, text);

  await saveTurn(userId, text, reply);

  return {
    reply,
    capturedTasks: captured.tasks,
    capturedMemories: captured.memories,
    intent: intent.action,
  };
}
