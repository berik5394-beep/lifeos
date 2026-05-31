import { prisma } from '../lib/prisma.js';
import { generateProactiveNotifications } from './proactive-notifications.js';
import { runPetStreakSweep } from './pet-streak-service.js';
import { deliverNotification } from './push-service.js';
import { deliverTopInsight } from './insight-store.js';
import { runReflectorDaily } from './reflector-service.js';
import { runProfileSynthesisWeekly } from './profile-synthesizer.js';
import { runTherapeuticDetectorsDaily } from './therapeutic-detector-service.js';
import { isV2ProactivityEnabled, isV2CronEnabled } from '../lib/feature-flags.js';
import { getProactivityEngine } from './v2-proactivity-engine.singleton.js';
import { withCronLock } from './cron-runner.js';
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

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  const startedAt = Date.now();
  let delivered = 0;

  try {
    // A.1: дневной пересчёт Pet.streak (идемпотентно, раз/день через
    // streakDate). Для ВСЕХ живых питомцев, не только push-юзеров —
    // мета-игра не должна зависеть от канала доставки.
    try {
      await runPetStreakSweep();
    } catch (err) {
      console.warn(
        '[scheduler] pet-streak sweep failed:',
        err instanceof Error ? err.message : err,
      );
    }

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

    // Только юзеры с хоть каким-то каналом доставки: expo push token
    // ИЛИ привязанный telegram. Остальных нет смысла обрабатывать.
    const tgUserIds = (
      await prisma.integration.findMany({
        where: { provider: 'telegram', active: true },
        select: { userId: true },
      })
    ).map((i) => i.userId);

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { expoPushToken: { not: null } },
          { id: { in: tgUserIds.length ? tgUserIds : ['__none__'] } },
        ],
      },
      select: { id: true },
    });

    const now = Date.now();

    // v2.0 Week 6 A5 — global cron hooks (mood-retention daily,
    // pattern-extraction weekly). Run BEFORE the per-user loop so that:
    //   - mood-retention's aggregate writes land before the proactivity
    //     engine reads MoodSnapshot in the loop below;
    //   - pattern-extraction's fresh patterns are visible to detectors
    //     on the same tick.
    // Both behind isV2CronEnabled (global); withCronLock enforces the
    // 24h / 7d interval regardless of how often tick fires. Each hook
    // is its own try/catch — a cron failure must not break the user loop.
    if (isV2CronEnabled()) {
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
    }

    for (const { id: userId } of users) {
      let notifications;
      try {
        notifications = await generateProactiveNotifications(userId);
      } catch (err) {
        console.warn(
          `[scheduler] generate failed user=${userId}:`,
          err instanceof Error ? err.message : err,
        );
        continue;
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

        const res = await deliverNotification(userId, n.title, n.body, {
          type: n.type,
        });
        if (res.push || res.telegram) {
          delivered++;
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

      // Phase 6 C2.5 — недельный синтез UserProfile. Каденс-гард в
      // runProfileSynthesisWeekly + дешёвый gate в profile-core
      // (неактивен/<недели/нет новых данных → пропуск ДО Sonnet) →
      // дёргать каждый тик безопасно/дёшево. НЕ-фатально (сбой/нет
      // ключа → профиль не трогаем, диалог не страдает).
      try {
        await runProfileSynthesisWeekly(userId, new Date());
      } catch (err) {
        console.warn(
          `[scheduler] profile synth failed user=${userId}:`,
          err instanceof Error ? err.message : err,
        );
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

      // v2.0 Week 5 E1 — proactivity engine tick (behind flag, per-user).
      // Runs before insight delivery so a nudge persisted this tick can
      // be pushed in the same loop iteration (unified insight store).
      // НЕ-фатально: per-user catch, остальные юзеры обрабатываются.
      if (isV2ProactivityEnabled(userId)) {
        try {
          await getProactivityEngine().runForUser(userId);
        } catch (err) {
          console.warn(
            `[v2-proactivity] runForUser failed user=${userId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      // R6 — ЕДИНЫЙ Insight-стор: ≤1 пуш/день, top-severity, вне
      // тихих часов (R11), tz-корректно. НЕ-фатально: сбой не должен
      // ронять тик/notifications. Идемпотентно по дню (deliveredAt).
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
