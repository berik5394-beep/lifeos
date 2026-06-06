# task-time reminder + конфликт задача↔календарь (P1 HOLLOW + кросс-домен)

**Дата:** 2026-06-06 · SERVER-only. Berik одобрил объём «ремайндер+конфликт».

## Проблема (аудит P1 HOLLOW)
`task.time` пишется (create-task.ts:54), CLAUDE.md обещает уведомление «за 30 мин
до задачи» + «конфликты при наложении задач и встреч». НО `generateEventReminders`
(proactive-notifications.ts) читает ТОЛЬКО CalendarEvent — `task.time` не читает
никто. Оба обещания мёртвые.

## Решение (2 части)

### Часть 1 — task reminder (закрывает HOLLOW)
`generateTaskReminders(userId, now=new Date())` рядом с generateEventReminders:
- tz + getToday; tasks `where {userId, date:today, completed:false, time:{not:null}}`.
- per task: `timeToDate(time, tz)` → thirtyMinBefore; если `>now` → ProactiveNotification
  `{title:'Скоро задача', body:'Через 30 минут: {title}', type:'task_reminder_30m', scheduledFor}`.
- Вписать в generateProactiveNotifications Promise.all + spread.
- **Дедуп/доставку наследует** (SentNotification unique + deliverNotification) — НЕ строим.
- Флаг `isV2TaskReminderEnabled` (FEATURE_V2_TASK_REMINDER); off → [] → байт-идентично.

### Часть 2 — кросс-домен задача↔календарь (слой B, врезка в мозг)
Чистый модуль `services/schedule-conflict/types.ts`:
- `hmToMinutes(hm)` "HH:MM"→минуты|null (валидация 0-23/0-59).
- `detectConflicts(tasks, events)`: task.time внутри окна события [start, end) того же
  дня; end = endTime||start+60мин (дефолт-окно). Возвращает список конфликтов.
- `formatScheduleConflict(conflicts)` → «⚠️ Конфликт расписания (предложи перенести): …» | ''.
Reader `services/schedule-conflict/conflict.ts` `buildScheduleConflict(userId)`:
- tz; today=localDayStartUTC; tasks(timed,incomplete) + events(startTime) сегодня →
  detectConflicts → format → string|null.
Врезка `scheduleConflict:string|null` в v2-enrichment (флаг `isV2ScheduleConflictEnabled`/
FEATURE_V2_SCHEDULE_CONFLICT, позиционно, off=байт-идентично). Мозг видит конфликт →
сам предлагает перенести (CLAUDE.md обещание).

## Тесты
- types.test.ts (pure): hmToMinutes valid/invalid; detectConflicts overlap/no-overlap/
  дефолт-окно без endTime/несколько; format пусто→''.
- task-reminder.it: generateTaskReminders(now=прошлое) timed→1 нотиф task_reminder_30m
  scheduledFor=timeToDate-30м; completed→0; без time→0; флаг off→0; cross-user→0.
- conflict.it (end-to-end): задача 14:00 + событие 14:00–15:00 → buildV2EnrichmentBlock
  содержит «⚠️ Конфликт»; задача 09:00 (нет пересечения)→нет; флаг off→нет.

## Money-safety / rollout
Read-only (нотификации/enrichment). Оба за флагами, off=байт-идентично. Push/deploy/
флаг=all — по слову Berik. Baseline ~2476 unit зелёный.
