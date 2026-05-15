import { prisma } from '../lib/prisma.js';
import { generateProactiveNotifications } from './proactive-notifications.js';
import { deliverNotification } from './push-service.js';

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
