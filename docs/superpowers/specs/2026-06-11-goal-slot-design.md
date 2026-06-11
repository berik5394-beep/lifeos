# Цель ↔ свободный слот (goal-slot) — Design Spec

> Дата: 2026-06-11. Ветка-источник: **main**. Server-only (`packages/server`).
> Контекст: кросс-домен #2, named-сценарий Berik («духовная цель отстаёт + четверг свободен → поставлю медитацию?», interconnection_map §2). Berik approved дизайн «2 части, один флаг».

**Goal:** Существующий `goal_behind`-нудж получает СЛОТ-якорь («В четверг в 18:00 свободно ~60 мин — поставить занятие? Скажи "да"») и ответ «да» НАЧИНАЕТ РАБОТАТЬ — нудж сохраняется в историю чата, агент видит контекст и ставит задачу обычными инструментами.

**Architecture:** Один флаг `FEATURE_V2_GOAL_SLOT`, off=байт-идентично. **Part 1:** read-only хелпер `goal-slot.ts` (`findUpcomingSlot` — ближайшее свободное окно [завтра..+7д] из календаря, реюз `findFreeSlots`; `formatGoalSlotTail` — чистый формат) → за флагом дописывает хвост к сообщению ПЕРВОЙ (самой отстающей) behind-цели в `proactive-insights.ts`. **Part 2:** после успешной доставки нуджа (`insight-store.ts deliverTopInsight`) текст сохраняется как assistant-`ChatMessage` (за тем же флагом) → следующий ответ юзера («да») приходит агенту С контекстом → действие через существующие `create_task`/`create_event` (никаких новых write-путей).

**Риск-принцип:** Part 1 read-only; слот РЕАЛЬНЫЙ из календаря (антифаб); TZ — civil-даты юзера (как get-free-slots, convA). Part 2 пишет ТОЛЬКО хронику ChatMessage (1 строка, ≤1/день по deliveredAt) — не данные; best-effort (`catch`), не роняет доставку. Off=байт-идентично оба.

**Tech Stack:** Fastify + Prisma6 + Postgres, ESM `.js`, TS strict no `any`, vitest, zero `vi.mock`. Коммит-на-шаг, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Текущее (проверено на main)
- `goal_behind`-инсайт УЖЕ есть (`proactive-insights.ts:472-489`): `planVsFact` → top-2 behind (`sort by gap`, `slice(0,2)`) → `insights.push({id:'goal_behind_'+area, message:'Ты ставил цель «X»…Отстаём — давай наверстаем?', dismissKey:…})`. БЕЗ слота/действия.
- `findFreeSlots(events, dateFrom, dateTo, minDurationMinutes): FreeSlot[]` (`tools/_slots.ts:20`) — multi-day, окно 09:00–20:00; `FreeSlot {date:'YYYY-MM-DD', from:'HH:MM', to:'HH:MM', durationMinutes}`.
- Образец календарь-запроса (`tools/get-free-slots.ts:27-41`): civil-даты `new Date(s+'T00:00:00Z')` (convA), `calendarEvent.findMany({where:{userId, date:{gte,lte}}, select:{date,startTime,endTime}, orderBy, take:200})`.
- Доставка (`insight-store.ts:248-263`): `deliverNotification(userId,'',row.message,{type:'insight',insightId})` → `{push,telegram}`; оба false → return; иначе `insight.update({deliveredAt})`. **Текст нуджа НЕ пишется в ChatMessage** → ответ «да» приходит агенту без контекста (дыра).
- `ChatMessage {userId, role, content, actions?, crisis @default(false), createdAt}`; `getRecentHistory` (`jarvis-orchestrator.ts:228`) берёт последние 6 `crisis:false` → сохранённый нудж ПОПАДЁТ в контекст следующего ответа.
- TZ-хелперы: `getUserTimezone` (`lib/user-context.js`), `localDateStr(tz, at)` (`lib/tz.ts`) — civil 'YYYY-MM-DD' юзера.

---

## Флаг
`feature-flags.ts` (зеркало `isV2OpenLoopsEnabled`):
```ts
/**
 * Цель↔слот: goal_behind-нудж получает слот-якорь («в чт 18:00 свободно — поставить?»)
 * + доставленный нудж пишется в ChatMessage (ответ «да» работает). OFF → сообщение
 * прежнее + ничего не пишется → байт-идентично.
 */
export function isV2GoalSlotEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_GOAL_SLOT, userId);
}
```

## Юнит A — `services/goal-slot.ts` (new)
```ts
import { prisma } from '../lib/prisma.js';
import { findFreeSlots, type FreeSlot } from '../tools/_slots.js';
import { getUserTimezone } from '../lib/user-context.js';
import { localDateStr } from '../lib/tz.js';

const RU_DAYS = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];

/** Имя дня (вин. падеж «в …») из civil 'YYYY-MM-DD'. TZ-безопасно (UTC-аксессоры по civil-дате). */
export function ruDayName(civilDate: string): string {
  return RU_DAYS[new Date(civilDate + 'T00:00:00Z').getUTCDay()];
}

/**
 * Ближайшее свободное окно ≥minDuration в [завтра..+horizonДн] по календарю юзера.
 * READ-ONLY. Завтра (не сегодня): findFreeSlots не учитывает «уже прошло сегодня».
 * Civil-даты юзера (convA, как get-free-slots). null = окна нет / ошибка (best-effort).
 */
export async function findUpcomingSlot(
  userId: string,
  now: Date = new Date(),
  minDurationMinutes = 45,
  horizonDays = 7,
): Promise<FreeSlot | null> {
  try {
    const tz = await getUserTimezone(userId);
    const todayCivil = localDateStr(tz, now);
    const dayMs = 86_400_000;
    const fromDate = new Date(new Date(todayCivil + 'T00:00:00Z').getTime() + dayMs); // завтра
    const toDate = new Date(fromDate.getTime() + (horizonDays - 1) * dayMs);
    const events = await prisma.calendarEvent.findMany({
      where: { userId, date: { gte: fromDate, lte: toDate } },
      select: { date: true, startTime: true, endTime: true },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: 200,
    });
    const slots = findFreeSlots(events, fromDate, toDate, minDurationMinutes);
    return slots[0] ?? null; // ближайший
  } catch {
    return null;
  }
}

/** Чистый хвост-предложение к goal_behind-сообщению. */
export function formatGoalSlotTail(slot: FreeSlot): string {
  const mins = Math.min(slot.durationMinutes, 120); // не обещаем «свободно 8ч», предлагаем сессию
  return ` В ${ruDayName(slot.date)} (${slot.date.slice(8, 10)}.${slot.date.slice(5, 7)}) в ${slot.from} свободно ~${mins} мин — поставить занятие по цели? Скажи «да» — закину в план.`;
}
```
(Сверить: `findFreeSlots`/`FreeSlot` экспортируются из `tools/_slots.ts`; `localDateStr` экспортирован из `lib/tz.ts` — если нет, использовать фактический экспорт-эквивалент.)

## Юнит B — Part 1: врезка в `proactive-insights.ts`
В блоке goal_behind (`:472-489`), внутри `for (const g of behind)`: за флагом для ПЕРВОЙ цели (top-gap) — слот-хвост:
```ts
for (const [i, g] of behind.entries()) {
  let message = `Ты ставил цель «${g.goalText}» (${g.area}): выполнено ~${g.progressPct}%, а год прошёл на ${expectedPct}%. Отстаём — давай наверстаем?`;
  if (i === 0 && isV2GoalSlotEnabled(userId)) {
    const slot = await findUpcomingSlot(userId, now);
    if (slot) message += formatGoalSlotTail(slot);
  }
  insights.push({ id: `goal_behind_${g.area}`, …, message, … });
}
```
(Точную форму петли/объекта сверить с фактическим кодом; `userId`/`now` — из области видимости билдера; функция уже async. **off** → `message` РОВНО прежняя строка-литерал → байт-идентично.)

## Юнит C — Part 2: врезка в `insight-store.ts` (deliverTopInsight)
После успешной доставки (`res.push || res.telegram`) и `deliveredAt`-апдейта:
```ts
// Reply-context: доставленный нудж — в историю чата, чтобы ответ «да»
// пришёл агенту С контекстом предложения (иначе «да» — в пустоту).
if (isV2GoalSlotEnabled(userId)) {
  await prisma.chatMessage
    .create({ data: { userId, role: 'assistant', content: row.message } })
    .catch(() => {});
}
```
`crisis` дефолт false → попадает в `getRecentHistory`. Best-effort — сбой НЕ роняет доставку. **off** → ничего не пишется → байт-идентично.

## Обработка ошибок
- `findUpcomingSlot` тотально best-effort (try/catch→null) → нет слота = старое сообщение без хвоста.
- Part 2 `.catch(()=>{})`. Ничего в критическом пути ответа.

## Тесты
**Unit:** флаг; `ruDayName` ('2026-06-11'→'четверг' — проверить реальный день недели даты); `formatGoalSlotTail` (содержит день/время/«Скажи «да»»; durationMinutes>120 → «~120 мин»). Структурный: `proactive-insights.ts` содержит `isV2GoalSlotEnabled`+`findUpcomingSlot`+`formatGoalSlotTail`; `insight-store.ts` содержит флаг-гейт + `chatMessage`-create + `role: 'assistant'`.
**Integration (`goal-slot.it.test.ts`):**
- Юзер (Asia/Almaty) + события: завтра занято 09:00–20:00 целиком, послезавтра свободно → `findUpcomingSlot` возвращает слот ПОСЛЕЗАВТРА (date=civil послезавтра, from='09:00').
- Пустой календарь → слот = завтра 09:00, duration 660.
- cross-user: чужие события не влияют.
- Part 2 helper-уровень: прямой `prisma.chatMessage.create`-путь покрыт структурно + (если дёшево) вызов фрагмента через export — НЕ тащить deliverNotification (внешние пуши) в тест.

## Декомпозиция (файлы)
| Файл | Изменение |
|------|-----------|
| `src/lib/feature-flags.ts` (+test) | `isV2GoalSlotEnabled` |
| `src/services/goal-slot.ts` (new) + `.test.ts` | `ruDayName`+`findUpcomingSlot`+`formatGoalSlotTail` |
| `src/services/proactive-insights.ts` | Part 1 слот-хвост за флагом |
| `src/services/insight-store.ts` | Part 2 ChatMessage-persist за флагом |
| `src/services/goal-slot-wiring.test.ts` (new) | структурный гард обеих врезок |
| `src/services/goal-slot.it.test.ts` (new) | интеграция (слоты/календарь/cross-user) |

## Rollout
Коммит-на-шаг (atomic TDD). Полный verify + независимое ревью (фокус: off=байт-идентично оба; Part1 read-only + слот реальный/TZ-civil; Part2 пишет только ChatMessage, best-effort, не ломает crisis-изоляцию и историю; «да»-поток работает через getRecentHistory). `push`/`deploy`/`FEATURE_V2_GOAL_SLOT=all` — ТОЛЬКО по слову Berik.

## Граница (честно)
- Слот-хвост — только у ПЕРВОЙ (top-gap) behind-цели; вторая — прежнее сообщение.
- Окно 09:00–20:00 жёсткое (как везде); [завтра..+7д] — сегодняшний вечер НЕ предлагаем (findFreeSlots не знает «сейчас»); персональное окно — потом.
- Part 2 помогает ВСЕМ нуджам (шире среза — осознанно, это включатель «да»-сценария); под этим же флагом.
- «да» → действие: через ОБЫЧНЫЙ агентский поток (контекст+create_task) — никакой новой FSM; качество исполнения «да» = качество агента.
