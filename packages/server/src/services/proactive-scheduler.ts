import { writeNightlyDiaries } from './robot-diary.js';
import { prisma } from '../lib/prisma.js';
import { generateProactiveNotifications } from './proactive-notifications.js';
import { withTimeout } from '../lib/with-timeout.js';
import { composeMorningBrief } from './morning-brief.js';
import { rememberBrief } from './today-brief.js';
import { localDateStr } from '../lib/tz.js';
import { deliverNotification } from './push-service.js';
import { deliverTopInsight } from './insight-store.js';
import { runReflectorDaily } from './reflector-service.js';
import { runTherapeuticDetectorsDaily } from './therapeutic-detector-service.js';
import { runWeekly, runEventCheck } from './reflector-v2/index.js';
import { getProactivityEngine } from './v2-proactivity-engine.singleton.js';
import { withCronLock } from './cron-runner.js';
import { buildDailyDigest, isOpsDigestHour } from './ai-economics.js';
import { runMemoryDedupeBackfill, backfillLogLine, type BackfillMode } from './cron/memory-dedupe-backfill.js';

/** Склейка старых дублей памяти: dry (счёт) → после просмотра цифр apply. */
const MEMORY_DEDUPE_BACKFILL_MODE: BackfillMode = 'apply';
import { hasOpsRecipients, opsAlertRecipients } from '../lib/ops-alert.js';
import { syncGoogleCalendar, GOOGLE_SYNC_INTERVAL_MS } from './google-calendar-sync.js';
import { runMoodRetention } from './cron/mood-retention-cron.js';
import { runPatternExtraction } from './cron/pattern-extraction-cron.js';
import { getBotTraitsStore } from './bot-traits/index.js';

/**
 * Фаза 4.1 — планировщик проактивности.
 *
 * Раньше `generateProactiveNotifications` вызывалась только когда клиент
 * сам опрашивал сервер → «уведомление за час до встречи» приходило лишь
 * если юзер в этот час открыл приложение. Теперь сервер сам тикает и
 * ПУШИТ (app-first: Expo Push в приложение + зеркало в Telegram).
 *
 * Тик каждые 10 минут. Для напоминаний «за 1ч / за 30мин» окно тика
 * означает, что 30-мин напоминание придёт где-то за 20-40 мин — для
 * бытовых напоминаний приемлемо.
 *
 * Дедуп через SentNotification (userId,type,scheduledFor uniqueness) —
 * одно и то же не уходит дважды на разных тиках.
 */

const TICK_MS = 10 * 60 * 1000; // 10 минут

let timer: NodeJS.Timeout | null = null;
let running = false; // защита от наложения тиков если один затянулся

/** Сколько дней без активности юзер без пушей ещё обрабатывается тиком. */
export const ACTIVE_NO_CHANNEL_DAYS = 14;

/**
 * Юзеры для тика. С каналом (expo push / активный Telegram) — всё как раньше.
 * Без канала, но писавшие роботу или создававшие задачи за 14 дней — тоже:
 * иначе отказ в пушах навсегда выключал проактивность (и «как ты?»), хотя
 * нудж мог бы прийти облачком в приложении.
 */
export async function selectTickUsers(now: Date): Promise<Array<{ id: string; hasChannel: boolean }>> {
  const tgUserIds = (
    await prisma.integration.findMany({
      where: { provider: 'telegram', active: true },
      select: { userId: true },
    })
  ).map((i) => i.userId);
  const withChannel = await prisma.user.findMany({
    where: {
      OR: [{ expoPushToken: { not: null } }, { id: { in: tgUserIds.length ? tgUserIds : ['__none__'] } }],
    },
    select: { id: true },
  });
  const since = new Date(now.getTime() - ACTIVE_NO_CHANNEL_DAYS * 86_400_000);
  const channelIds = new Set(withChannel.map((u) => u.id));
  const [talked, tasked] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { role: 'user', createdAt: { gte: since } },
      distinct: ['userId'],
      select: { userId: true },
    }),
    prisma.task.findMany({ where: { createdAt: { gte: since } }, distinct: ['userId'], select: { userId: true } }),
  ]);
  const active = new Set([...talked, ...tasked].map((r) => r.userId).filter((id) => !channelIds.has(id)));
  return [
    ...withChannel.map((u) => ({ id: u.id, hasChannel: true })),
    ...[...active].map((id) => ({ id, hasChannel: false })),
  ];
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  const startedAt = Date.now();
  let delivered = 0;

  try {
    // Phase 6 C1 crisis-isolation (b): retention 30 дней для
    // sensitive кризис-ходов. Идемпотентно by nature (deleteMany
    // только >30д crisis=true); индекс (crisis, createdAt) делает
    // это микросекундным когда удалять нечего. НЕ-фатально.
    try {
      const cutoff = new Date(Date.now() - 30 * 86_400_000);
      const purged = await prisma.chatMessage.deleteMany({
        where: { crisis: true, createdAt: { lt: cutoff } },
      });
      if (purged.count > 0) {
        console.log(`[scheduler] crisis retention: purged ${purged.count}`);
      }
    } catch (err) {
      console.warn(
        '[scheduler] crisis purge failed:',
        err instanceof Error ? err.message : err,
      );
    }

    // F (робот-друг): дневник робота за вчера — ночью по часам человека,
    // а не только при открытии экрана (тогда роботу есть чем делиться).
    try {
      const n = await writeNightlyDiaries(new Date());
      if (n > 0) console.log(`[scheduler] robot diary nightly: ${n}`);
    } catch (err) {
      console.warn('[scheduler] robot diary nightly failed:', err instanceof Error ? err.message : err);
    }

    // Кого обрабатывать: юзеры с каналом доставки (пуш/Telegram) + активные
    // за 14 дней без канала — им робот тоже «думает» (детекторы, «как ты?»),
    // нудж придёт облачком при открытии (/nudges/next). Пуши им не шлём.
    const users = await selectTickUsers(new Date());

    const now = Date.now();

    // Google Calendar → встречи у мозга без ручной кнопки: раз в час на юзера
    // с активной интеграцией (раньше только «Синхронизировать» в настройках —
    // встречу из Google мозг не видел и не напоминал о ней).
    try {
      const gcal = await prisma.integration.findMany({
        where: { provider: 'google_calendar', active: true, refreshToken: { not: null } },
        select: { userId: true },
      });
      for (const { userId: gUser } of gcal) {
        try {
          // Ошибку (отозван доступ, Google лежит) гасим ВНУТРИ — тогда запуск
          // засчитан и следующая попытка через час, а не каждые 10 минут.
          await withCronLock('google-calendar-sync', GOOGLE_SYNC_INTERVAL_MS, gUser, () =>
            syncGoogleCalendar(gUser).catch((err) => {
              console.warn(`[scheduler] google sync failed user=${gUser}:`, err instanceof Error ? err.message : err);
              return null;
            }),
          );
        } catch (err) {
          console.warn(`[scheduler] google sync failed user=${gUser}:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.warn('[scheduler] google sync list failed:', err instanceof Error ? err.message : err);
    }

    // v2.0 Week 6 A5 — global cron hooks (mood-retention daily,
    // pattern-extraction weekly). Run BEFORE the per-user loop so that:
    //   - mood-retention's aggregate writes land before the proactivity
    //     engine reads MoodSnapshot in the loop below;
    //   - pattern-extraction's fresh patterns are visible to detectors
    //     on the same tick.
    // Глобальные (без флага); withCronLock enforces the
    // 24h / 7d interval regardless of how often tick fires. Each hook
    // is its own try/catch — a cron failure must not break the user loop.
    // Разовая склейка старых дублей памяти (Berik 2026-11-10). Один запуск на
    // имя задачи (замок на 10 лет): сначала dry — только счёт в лог; apply —
    // отдельным деплоем после просмотра цифр. Пары id — в лог (вернуть: restoreMemory).
    try {
      await withCronLock(`memory-dedupe-backfill-${MEMORY_DEDUPE_BACKFILL_MODE}-v1`, 3650 * 24 * 60 * 60 * 1000, null, async () => {
        const r = await runMemoryDedupeBackfill(MEMORY_DEDUPE_BACKFILL_MODE);
        console.log(backfillLogLine(r));
        for (let i = 0; i < r.pairs.length; i += 40) {
          console.log(`[memory-dedupe] pairs ${r.pairs.slice(i, i + 40).map((p) => `${p.from}>${p.into}`).join(' ')}`);
        }
      });
    } catch (err) {
      console.warn('[memory-dedupe] failed:', err instanceof Error ? err.message : err);
    }

    // Утренняя сводка владельцу (Berik 2026-11-09): люди, стоимость моделей на
    // человека, вернулись ли, сбои — за вчера. 09:00 по Алматы (04 UTC), раз в день.
    if (isOpsDigestHour(new Date()) && hasOpsRecipients()) {
      try {
        await withCronLock('ops-digest', 20 * 60 * 60 * 1000, null, async () => {
          const d = await buildDailyDigest();
          console.log(`[ops-digest] ${d.title} ${d.body.replace(/\n/g, ' | ')}`);
          const ids = await opsAlertRecipients();
          await Promise.all(ids.map((id) => deliverNotification(id, d.title, d.body, { type: 'ops_digest' })));
        });
      } catch (err) {
        console.warn('[ops-digest] failed:', err instanceof Error ? err.message : err);
      }
    }

    try {
      const r = await withCronLock(
        'mood-retention',
        24 * 60 * 60 * 1000,
        null,
        runMoodRetention,
      );
      if (r.ran) console.log('[cron:mood-retention] tick: ran');
    } catch (err) {
      console.warn(
        '[cron:mood-retention] tick hook failed:',
        err instanceof Error ? err.message : err,
      );
    }
    try {
      const r = await withCronLock(
        'pattern-extraction',
        7 * 24 * 60 * 60 * 1000,
        null,
        runPatternExtraction,
      );
      if (r.ran) console.log('[cron:pattern-extraction] tick: ran');
    } catch (err) {
      console.warn(
        '[cron:pattern-extraction] tick hook failed:',
        err instanceof Error ? err.message : err,
      );
    }
    // v2 Phase B2 — weekly bot-traits snapshot + refresh.
    try {
      await withCronLock('bot-traits-snapshot', 7 * 24 * 60 * 60 * 1000, null, async () => {
        const store = getBotTraitsStore();
        // Reuse the active-user set already computed for pattern-extraction
        // if available; otherwise fetch users active in last 7 days.
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const activeUserRows = await prisma.chatMessage.findMany({
          where: { createdAt: { gte: since } },
          select: { userId: true },
          distinct: ['userId'],
        });
        for (const { userId } of activeUserRows) {
          try {
            await store.refreshTraits(userId);
            await store.snapshot(userId);
          } catch (err) {
            console.warn(`[cron:bot-traits] user=${userId}:`, err);
          }
        }
        console.log(`[cron:bot-traits] snapshotted ${activeUserRows.length} active users`);
      });
    } catch (err) {
      console.warn('[cron:bot-traits] tick failed:', err);
    }

    for (const { id: userId, hasChannel } of users) {
      let notifications: Awaited<ReturnType<typeof generateProactiveNotifications>> = [];
      // Без канала напоминания/брифы доставить некуда — только «думаем» ниже.
      if (hasChannel) {
        try {
          notifications = await generateProactiveNotifications(userId);
        } catch (err) {
          console.warn(
            `[scheduler] generate failed user=${userId}:`,
            err instanceof Error ? err.message : err,
          );
          continue;
        }
      }

      for (const n of notifications) {
        // Ещё не время — пропускаем (придёт на будущем тике).
        if (n.scheduledFor.getTime() > now) continue;
        // Слишком старое (>2ч просрочки) — не спамим неактуальным.
        if (now - n.scheduledFor.getTime() > 2 * 60 * 60 * 1000) continue;

        // Дедуп: уже отправляли это (userId,type,scheduledFor)?
        try {
          await prisma.sentNotification.create({
            data: {
              userId,
              type: n.type,
              scheduledFor: n.scheduledFor,
              channel: 'pending',
            },
          });
        } catch {
          // unique violation → уже отправлено, пропускаем
          continue;
        }

        // Этап 4: утренний бриф пересказывает мозг (стиль, бюджет, долги,
        // перегруз, темп целей) — раз в день, уже после дедупа. Сбой/долго —
        // честный шаблон из тех же фактов.
        const body =
          n.type === 'morning_briefing'
            ? await withTimeout(composeMorningBrief(userId, n.body), 10_000, n.body).catch(() => n.body)
            : n.body;
        // Тот же бриф покажет приложение утром (карточка приветствия), а не другой текст.
        if (n.type === 'morning_briefing') {
          const tz = (await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }))?.timezone || 'UTC';
          rememberBrief(userId, localDateStr(tz, new Date()), { title: n.title, text: body });
        }
        const res = await deliverNotification(userId, n.title, body, {
          type: n.type,
        });
        if (res.push || res.telegram) {
          delivered++;
          // Пуш с вопросом («…Начнём?» в брифе) — и в историю чата: иначе ответ
          // «да» приходил мозгу без контекста, ответить было не на что (аудит
          // 2026-11-08). Как доставленные нуджи (insight-store). Best-effort.
          if (n.type === 'morning_briefing' || /\?\s*$/.test(body.trim())) {
            await prisma.chatMessage.create({ data: { userId, role: 'assistant', content: body } }).catch(() => {});
          }
          await prisma.sentNotification
            .updateMany({
              where: { userId, type: n.type, scheduledFor: n.scheduledFor },
              data: {
                channel: res.push && res.telegram ? 'both' : res.push ? 'push' : 'telegram',
              },
            })
            .catch(() => {});
        } else {
          // Доставка не удалась — удаляем dedup-запись, попробуем на
          // следующем тике (вдруг временный сбой Expo/Telegram).
          await prisma.sentNotification
            .deleteMany({ where: { userId, type: n.type, scheduledFor: n.scheduledFor } })
            .catch(() => {});
        }
      }

      // P3.b — рефлектор: 1×/день/юзер (tz-корректно), детерминизм
      // решает + Sonnet перефразирует, source='reflector' в ЕДИНЫЙ
      // стор. ПЕРЕД доставкой — свежий инсайт уйдёт этим же тиком.
      // НЕ-фатально: сбой/Claude-down не роняет тик (детерминизм
      // уже честен, fallback внутри сервиса).
      try {
        await runReflectorDaily(userId, new Date());
      } catch (err) {
        console.warn(
          `[scheduler] reflector failed user=${userId}:`,
          err instanceof Error ? err.message : err,
        );
      }
      try {
        await runWeekly(userId, new Date());
        await runEventCheck(userId, new Date());
      } catch (err) {
        console.warn('[reflector-v2:scheduler] failed:', err);
      }

      // Phase 6 C4 — therapeutic-детекторы 1×/день/юзер. ≤1
      // therapeutic-инсайт создаётся (top-severity); R10 cooldown +
      // R6 доставка + R11 quiet-hours применяются автоматом.
      // C1(d): conflict-mentions читаются с crisis=false. НЕ-фатально.
      try {
        await runTherapeuticDetectorsDaily(userId, new Date());
      } catch (err) {
        console.warn(
          `[scheduler] therapeutic detectors failed user=${userId}:`,
          err instanceof Error ? err.message : err,
        );
      }

      // v2.0 Week 5 E1 — proactivity engine tick (per-user).
      // Runs before insight delivery so a nudge persisted this tick can
      // be pushed in the same loop iteration (unified insight store).
      // НЕ-фатально: per-user catch, остальные юзеры обрабатываются.
      try {
        await getProactivityEngine().runForUser(userId);
      } catch (err) {
        console.warn(
          `[v2-proactivity] runForUser failed user=${userId}:`,
          err instanceof Error ? err.message : err,
        );
      }

      // R6 — ЕДИНЫЙ Insight-стор: ≤1 пуш/день, top-severity, вне
      // тихих часов (R11), tz-корректно. НЕ-фатально: сбой не должен
      // ронять тик/notifications. Идемпотентно по дню (deliveredAt).
      // Пуш нужен канал; без него нудж ждёт открытия приложения (/nudges/next).
      if (hasChannel) {
        try {
          const ins = await deliverTopInsight(userId, new Date());
          if (ins.deliveredId) delivered++;
        } catch (err) {
          console.warn(
            `[scheduler] insight push failed user=${userId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    if (delivered > 0) {
      console.log(
        `[scheduler] tick done: ${delivered} delivered, ${users.length} users, ${
          Date.now() - startedAt
        }ms`,
      );
    }
  } catch (err) {
    console.error('[scheduler] tick error:', err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startProactiveScheduler(): void {
  if (timer) return;
  // Первый тик через минуту после старта (дать серверу прогреться),
  // дальше каждые TICK_MS.
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), TICK_MS);
  }, 60_000).unref?.();
  console.log('[scheduler] proactive scheduler armed (tick 10m)');
}

export function stopProactiveScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
