import { Telegraf } from 'telegraf';
import type { Context } from 'telegraf';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { transcribeAudio } from './dictation-service.js';
import { handleMessage } from './jarvis-orchestrator.js';
import { getBotIdentityService } from './bot-identity.singleton.js';
import { getUserAxesStore } from './user-axes/index.js';
import { axisLabel, type AxisName } from './user-axes/index.js';
import { isV2AxesEnabled } from '../lib/feature-flags.js';
import { getFeedbackStore } from './feedback/index.js';
import { getBotTraitsStore, traitLabel } from './bot-traits/index.js';
import { generateGrowthNarrative } from './bot-traits/growth-narrative.js';
import { isV2IdentityEnabled } from '../lib/feature-flags.js';

/**
 * LifeOS Telegram Bot — полноценный JARVIS в Telegram.
 *
 * Архитектура: бот — это просто ещё один интерфейс к тому же backend.
 * Тот же Claude, та же память, та же БД что у мобилки. Юзер пишущий боту
 * и юзер в приложении — это разные интерфейсы, но если их аккаунты связаны,
 * данные общие.
 *
 * Авторизация: при /start автоматически создаём LifeOS-аккаунт привязанный
 * к Telegram ID (синтетический email tg{id}@telegram.lifeos). Юзеру не надо
 * регистрироваться — 0 friction, главное преимущество TG-канала.
 *
 * Что умеет:
 *  - Голосовое сообщение → диктофон (задачи + память + ответ)
 *  - Текст → JARVIS-чат с памятью
 *  - "Забронируй рейс/такси/отель" → smart booking URL + озвучка
 *  - Быстрые команды: задачи / привычки / брифинг
 */

interface TelegramSettings {
  chatId: string;
  telegramId: number;
  username?: string;
}

/**
 * Находит или создаёт LifeOS-юзера для Telegram chatId.
 * Идемпотентно: повторный /start того же юзера вернёт существующий аккаунт.
 */
async function findOrCreateUser(
  chatId: string,
  telegramId: number,
  firstName: string,
  username?: string,
): Promise<string> {
  // Ищем существующую привязку
  const integrations = await prisma.integration.findMany({
    where: { provider: 'telegram', active: true },
    select: { userId: true, settings: true },
  });
  for (const integ of integrations) {
    const s = integ.settings as unknown as TelegramSettings;
    if (s.chatId === chatId) return integ.userId;
  }

  // Создаём нового юзера + привязку атомарно
  const syntheticEmail = `tg${telegramId}@telegram.lifeos`;
  const randomPassword = crypto.randomBytes(24).toString('hex');
  const passwordHash = await bcrypt.hash(randomPassword, 10);

  const user = await prisma.$transaction(async (tx) => {
    // Защита от гонки: вдруг параллельный /start уже создал юзера
    const existing = await tx.user.findUnique({
      where: { email: syntheticEmail },
      select: { id: true },
    });
    const u =
      existing ??
      (await tx.user.create({
        data: {
          email: syntheticEmail,
          name: (firstName || username || 'Друг').slice(0, 64),
          passwordHash,
        },
        select: { id: true },
      }));

    await tx.integration.upsert({
      where: { userId_provider: { userId: u.id, provider: 'telegram' } },
      create: {
        userId: u.id,
        provider: 'telegram',
        active: true,
        settings: { chatId, telegramId, username: username ?? null },
      },
      update: {
        active: true,
        settings: { chatId, telegramId, username: username ?? null },
      },
    });
    return u;
  });

  return user.id;
}

/** Скачивает файл из Telegram и возвращает base64. */
async function downloadTelegramFile(
  bot: Telegraf,
  fileId: string,
): Promise<string> {
  const link = await bot.telegram.getFileLink(fileId);
  const res = await fetch(link.href);
  if (!res.ok) throw new Error(`Не удалось скачать файл: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

// ---- Быстрые команды (не AI, дёшево) -------------------------------------

async function quickTasks(userId: string): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tasks = await prisma.task.findMany({
    where: { userId, date: today },
    orderBy: { completed: 'asc' },
    select: { title: true, completed: true },
  });
  if (tasks.length === 0) return '📋 На сегодня задач нет.';
  const lines = tasks.map((t) => `${t.completed ? '✅' : '⬜'} ${t.title}`);
  const done = tasks.filter((t) => t.completed).length;
  return `📋 Задачи (${done}/${tasks.length}):\n\n${lines.join('\n')}`;
}

async function quickHabits(userId: string): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [habits, logs] = await Promise.all([
    prisma.habit.findMany({ where: { userId, active: true }, select: { id: true, name: true } }),
    prisma.habitLog.findMany({
      where: { userId, date: today, completed: true },
      select: { habitId: true },
    }),
  ]);
  if (habits.length === 0) return '🔄 Активных привычек нет.';
  const doneIds = new Set(logs.map((l) => l.habitId));
  const lines = habits.map((h) => `${doneIds.has(h.id) ? '✅' : '⬜'} ${h.name}`);
  return `🔄 Привычки (${doneIds.size}/${habits.length}):\n\n${lines.join('\n')}`;
}

const QUICK_TASKS = /^(задачи|tasks|что по задачам|план на день)$/i;
const QUICK_HABITS = /^(привычки|habits|что по привычкам)$/i;

// ---- Bot --------------------------------------------------------------------

export function createTelegramBot(): Telegraf {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN не задан');
  }

  const bot = new Telegraf(token);

  bot.start(async (ctx: Context) => {
    const chatId = String(ctx.chat?.id);
    const from = ctx.from;
    if (!chatId || !from) return;
    try {
      await findOrCreateUser(
        chatId,
        from.id,
        from.first_name || '',
        from.username,
      );
      await ctx.reply(
        `Привет, ${from.first_name || 'друг'}! Я твой JARVIS 🤖\n\n` +
          'Я не просто бот с командами — я думаю, помню и помогаю.\n\n' +
          '🎙️ *Запиши голосовое* — я выделю задачи и запомню важное\n' +
          '💬 *Напиши что угодно* — отвечу, помогу, посоветую\n' +
          '✈️ *"Забронируй рейс в Астану"* — дам ссылку и подскажу по времени\n' +
          '📋 *"задачи"* / *"привычки"* — быстрый статус\n\n' +
          'Расскажи о себе пару фраз голосом — я начну тебя узнавать.',
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      console.error('TG /start error:', err);
      await ctx.reply('Ошибка инициализации. Попробуй /start ещё раз.');
    }
  });

  // v2.0 Week 5 (spec §10.1) — user renames the bot.
  // Validation: 1..30 chars after trim. Persists via IdentityService;
  // the new name flows back into prompts through buildV2EnrichmentBlock
  // (D2) on the very next turn.
  bot.command('setname', async (ctx) => {
    const chatId = String(ctx.chat?.id);
    const from = ctx.from;
    if (!chatId || !from) return;
    const newName = (ctx.message.text ?? '')
      .split(' ')
      .slice(1)
      .join(' ')
      .trim();
    if (newName.length < 1) {
      await ctx.reply('Использование: /setname Имя');
      return;
    }
    if (newName.length > 30) {
      await ctx.reply('Имя слишком длинное (макс 30 символов)');
      return;
    }
    try {
      const userId = await findOrCreateUser(
        chatId,
        from.id,
        from.first_name || '',
        from.username,
      );
      await getBotIdentityService().updateIdentity(userId, {
        botName: newName,
      });
      await ctx.reply(`Готово, теперь меня зовут ${newName} 🤍`);
    } catch (err) {
      console.error('TG /setname error:', err);
      await ctx.reply('Не получилось переименовать — попробуй ещё раз?');
    }
  });

  // v2 Phase B1 — /axes transparency command
  bot.command('axes', async (ctx) => {
    if (!ctx.message) return;
    try {
      const chatId = String(ctx.chat?.id);
      const from = ctx.from;
      if (!chatId || !from) return;
      const userId = await findOrCreateUser(
        chatId,
        from.id,
        from.first_name || '',
        from.username,
      );
      if (!isV2AxesEnabled(userId)) {
        await ctx.reply('Личностные оси выключены для тебя. Спроси админа подключить FEATURE_V2_AXES.');
        return;
      }
      const text = await formatAxesForTelegram(userId);
      await ctx.reply(text);
    } catch (err) {
      console.warn('[telegram:axes] failed:', err);
      await ctx.reply('Не получилось получить axes. Попробуй позже.');
    }
  });

  // v2 Phase B2 — /identity persona + growth narrative
  bot.command('identity', async (ctx) => {
    if (!ctx.message) return;
    try {
      const chatId = String(ctx.chat?.id);
      const from = ctx.from;
      if (!chatId || !from) return;
      const userId = await findOrCreateUser(
        chatId,
        from.id,
        from.first_name || '',
        from.username,
      );
      if (!isV2IdentityEnabled(userId)) {
        await ctx.reply('Identity evolution выключена для тебя.');
        return;
      }
      const text = await formatIdentityForTelegram(userId);
      await ctx.reply(text);
    } catch (err) {
      console.warn('[telegram:identity] failed:', err);
      await ctx.reply('Не получилось показать identity. Попробуй позже.');
    }
  });

  // Голосовое → транскрипция → ОРКЕСТРАТОР (не всегда диктофон!).
  // Раньше голос всегда шёл в processDictation (просто запись задач) —
  // это и делало бота "блокнотом". Теперь: расшифровали → отдали мозгу,
  // он сам решает (booking / вопрос с web-поиском / запись).
  bot.on('voice', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const from = ctx.from;
    try {
      const userId = await findOrCreateUser(
        chatId,
        from.id,
        from.first_name || '',
        from.username,
      );
      await ctx.sendChatAction('typing');
      const fileId = ctx.message.voice.file_id;
      const audioB64 = await downloadTelegramFile(bot, fileId);
      // Telegram voice = OGG Opus. Groq принимает .ogg (не .oga).
      const transcript = await transcribeAudio(audioB64, 'ogg');
      if (!transcript || transcript.trim().length < 2) {
        await ctx.reply('Не расслышал. Повтори, пожалуйста?');
        return;
      }
      // ISSUE-4: голосовое сообщение Telegram (транскрипт) → 'voice'.
      const res = await handleMessage(userId, transcript, 'voice');
      await sendJarvis(ctx, res);
    } catch (err) {
      console.error('TG voice error:', err);
      await ctx.reply('Не смог обработать запись. Попробуй ещё раз?');
    }
  });

  // Текст → ОРКЕСТРАТОР (тот же мозг что и голос).
  bot.on('text', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const from = ctx.from;
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    try {
      const userId = await findOrCreateUser(
        chatId,
        from.id,
        from.first_name || '',
        from.username,
      );

      // Быстрые команды без AI (дёшево, мгновенно)
      if (QUICK_TASKS.test(text)) {
        await ctx.reply(await quickTasks(userId));
        return;
      }
      if (QUICK_HABITS.test(text)) {
        await ctx.reply(await quickHabits(userId));
        return;
      }

      await ctx.sendChatAction('typing');
      const res = await handleMessage(userId, text);
      await sendJarvis(ctx, res);
    } catch (err) {
      console.error('TG text error:', err);
      await ctx.reply('Что-то пошло не так. Попробуй ещё раз через секунду.');
    }
  });

  return bot;
}

/**
 * Единый рендер ответа JARVIS в Telegram: текст + (опц.) ссылка booking +
 * лёгкая пометка что записал в фоне (если что-то извлёк).
 */
async function sendJarvis(
  ctx: Context,
  res: import('./jarvis-orchestrator.js').JarvisResponse,
): Promise<void> {
  let msg = res.reply;
  if (res.bookingUrl) {
    msg += `\n\n🔗 ${res.bookingUrl}`;
  }
  // SSOT Step 7: бейдж — только реальные исполненные инструменты
  // (ToolCall-аудит), не NLP-выдумка captureInBackground.
  // Friend-UX: бейдж выглядит как SQL-trace для юзера → скрыт по
  // умолчанию. Включить для debug: DEBUG_AUDIT_FOOTER=true в env.
  if (
    process.env.DEBUG_AUDIT_FOOTER === 'true' &&
    res.auditedActions && res.auditedActions > 0
  ) {
    msg += `\n\n— ✅ выполнено действий: ${res.auditedActions}`;
  }
  // БЕЗ parse_mode: ответ Claude (+ web search URLs) содержит непарные
  // _ * [ ( ` — строгий Markdown-парсер Telegram падает с
  // "can't parse entities". AI-контент шлём как plain text.
  //
  // Telegram hard limit — 4096 символов на сообщение. Агентные ответы с
  // web search бывают длинными → режем на части по границам абзацев,
  // иначе Telegram отклонит весь ответ с 400.
  for (const chunk of splitForTelegram(msg)) {
    await ctx.reply(chunk);
  }
}

const TG_LIMIT = 4000; // запас от 4096 на всякий случай

/**
 * Режет длинный текст на куски ≤ TG_LIMIT, стараясь рвать по двойным
 * переносам (абзацы), затем по одиночным, в крайнем случае — жёстко.
 */
function splitForTelegram(text: string): string[] {
  if (text.length <= TG_LIMIT) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > TG_LIMIT) {
    let cut = rest.lastIndexOf('\n\n', TG_LIMIT);
    if (cut < TG_LIMIT * 0.5) cut = rest.lastIndexOf('\n', TG_LIMIT);
    if (cut < TG_LIMIT * 0.5) cut = rest.lastIndexOf('. ', TG_LIMIT);
    if (cut < TG_LIMIT * 0.5) cut = TG_LIMIT; // жёстко если нет границ
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

async function formatAxesForTelegram(userId: string): Promise<string> {
  const axes = await getUserAxesStore().getAxes(userId);
  const labels: Array<[string, AxisName, number, string]> = [
    ['🎯', 'self_discipline', axes.selfDiscipline, 'self-discipline'],
    ['💖', 'emotional_openness', axes.emotionalOpenness, 'emotional-openness'],
    ['🥊', 'conflict_tolerance', axes.conflictTolerance, 'conflict-tolerance'],
    ['🔍', 'introspection_depth', axes.introspectionDepth, 'introspection-depth'],
  ];

  const lines: string[] = ['Твои личностные оси (continuous 0..1):', ''];
  for (const [emoji, axisName, value, displayName] of labels) {
    lines.push(`${emoji} ${displayName}: ${value.toFixed(2)} (${axisLabel(value)})`);
    const recent = await getUserAxesStore().recentSignals(userId, axisName, 3);
    if (recent.length > 0) {
      lines.push('   Свежие сигналы:');
      for (const s of recent) {
        const sign = s.delta >= 0 ? '+' : '';
        const when = relativeDate(s.recordedAt);
        const exc = s.excerpt ? ` «${s.excerpt.slice(0, 50)}»` : '';
        lines.push(`   • ${sign}${s.delta.toFixed(2)}${exc} (${when})`);
      }
    }
    lines.push('');
  }
  lines.push(`Всего сигналов: ${axes.signalCount}`);

  // v2 B3 — recent feedback corrections (transparency). Hidden if none.
  try {
    const corrections = await getFeedbackStore().recentCorrections(userId, 5);
    const withNote = corrections.filter((c) => c.styleNote);
    if (withNote.length > 0) {
      lines.push('');
      lines.push('🔧 Недавние коррекции:');
      for (const c of withNote) {
        lines.push(`• ${c.styleNote}`);
      }
    }
  } catch (err) {
    console.warn('[telegram:axes:corrections] failed:', err);
  }

  return lines.join('\n').trim();
}

async function formatIdentityForTelegram(userId: string): Promise<string> {
  const store = getBotTraitsStore();
  const traits = await store.getTraits(userId);
  const identity = await getBotIdentityService().getIdentity(userId);
  const history = await store.snapshotHistory(userId, 50);
  const oldest = history.length >= 2 ? history[0] : null;
  const narrative = await generateGrowthNarrative(oldest, traits, identity.botName);

  const lines: string[] = [
    `Я — ${identity.botName} ${identity.avatar}`,
    '',
    'Сейчас с тобой я:',
    `🔥 warmth: ${traits.warmth.toFixed(2)} (${traitLabel(traits.warmth)})`,
    `🎯 directness: ${traits.directness.toFixed(2)} (${traitLabel(traits.directness)})`,
    `😄 humor: ${traits.humor.toFixed(2)} (${traitLabel(traits.humor)})`,
    `⚡ playfulness: ${traits.playfulness.toFixed(2)} (${traitLabel(traits.playfulness)})`,
    '',
    `Глубина связи: ${traits.relationshipDepth.toFixed(2)}`,
    '',
    'Как я изменилась:',
    narrative,
  ];
  return lines.join('\n');
}

function relativeDate(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400_000);
  if (diffDays === 0) return 'сегодня';
  if (diffDays === 1) return 'вчера';
  if (diffDays < 7) return `${diffDays} дней назад`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} нед. назад`;
  return d.toISOString().slice(0, 10);
}

let activeBot: Telegraf | null = null;

export async function startBot(): Promise<Telegraf | null> {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log('TELEGRAM_BOT_TOKEN не задан — бот не запускается');
    return null;
  }
  const bot = createTelegramBot();
  activeBot = bot;
  // launch() резолвится только при остановке — НЕ await'им, иначе сервер
  // зависнет на старте. Запускаем в фоне, ошибки логируем.
  bot.launch().catch((err) => {
    console.error('Telegram бот упал:', err);
  });
  console.log('Telegram бот запущен (@LifeOS_jarvis_bot)');
  return bot;
}

/**
 * Отправить сообщение конкретному chatId через активного бота.
 * Используется планировщиком для ЗЕРКАЛА проактивных уведомлений
 * (primary-канал — Expo Push в приложение; это secondary).
 * Возвращает true если отправлено.
 */
export async function sendTelegramTo(
  chatId: string | number,
  text: string,
): Promise<boolean> {
  if (!activeBot) return false;
  try {
    await activeBot.telegram.sendMessage(chatId, text);
    return true;
  } catch (err) {
    console.warn('[push] telegram mirror failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

export function stopBot(): void {
  if (activeBot) {
    activeBot.stop('SIGTERM');
    activeBot = null;
    console.log('Telegram бот остановлен');
  }
}
