# Open-loops «что не закрыто сейчас» — Design Spec

> Дата: 2026-06-11. Ветка-источник: **main**. Server-only (`packages/server`).
> Контекст: кросс-домен #2 (фундамент §3 «кто что делает сейчас», `interconnection_map.md`). Berik выбрал под-проект + форму «счётчики+пункты+проактивный нудж».

**Goal:** Мозг ВИДИТ снимок незакрытого СЕЙЧАС (просрочки + неотмеченные сегодня привычки + ждущее подтверждение) перед каждым ответом и при завале мягко предлагает разгрести. Сейчас в промпт идёт только ПРОШЛОЕ (top-6 событий) — не открытые петли.

**Architecture:** Один read-only сборщик `gatherOpenLoops(userId, todayStart)` → ДВА потребителя за флагом `FEATURE_V2_OPEN_LOOPS` (off=байт-идентично): (1) блок-осознание в `v2-enrichment.ts`; (2) проактивный нудж `open_loop_pileup` в `v2-proactivity-engine.ts` (с дедупом ≤1/день). DRY: одна gather-функция, два consumer'а.

**Риск-принцип:** read-only (0 записей). Все числа/пункты — РЕАЛЬНЫЕ из БД (антифаб, без выдумки — урок галлюцинаций). Нудж дедуплен (урок бага денег + day-load). Друг, не нытьё: блок = тихое осознание, нудж только при завале.

**Tech Stack:** Fastify + Prisma6 + Postgres, ESM `.js`, TS strict no `any`, vitest, zero `vi.mock`. Коммит-на-шаг, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Текущее (проверено на main)
- `countOverduePending(userId, todayStart): Promise<number>` + `listOverduePending(userId, todayStart, take=3): Promise<{title,date}[]>` (`task-overdue.ts`) — READ-ONLY, уже есть. todayStart = UTC-instant начала локального дня.
- `PendingAction { userId @id, action, inputJson, confirmationText, createdAt }` — **userId=@id → 0 или 1 на юзера**. «Ждёт подтверждение» = существует ли строка.
- `Habit { id, userId, name, active }`; `HabitLog { habitId, userId, date @db.Date, completed }`.
- Enrichment: `V2EnrichmentData` (тип, `recentActivity:string|null` и т.п.) → `fetchV2EnrichmentData` Promise.all (:333) destructure → `buildV2EnrichmentBlock` (:117) `if(data.X) lines.push(data.X)` (:162-163).
- Proactivity: `NudgeSource` union (:19) · `NudgeCandidate {source,...,toneHint}` (:43) · `scoreSignificance` switch (:68) · `TEMPLATES: Record<NudgeSource,...>` (:217) · детектор-образец `detectGoalHabitsStall`+candidate (:730-745) + регистрация в оркестраторе детекторов.

---

## Флаг
`feature-flags.ts` — новый (зеркало `isV2GoalHabitsEnabled`):
```ts
/**
 * Open-loops: снимок незакрытого СЕЙЧАС (просрочки/привычки/pending) в промпт +
 * проактивный нудж при завале. READ-ONLY. OFF → блок не добавляется + детектор []
 * → байт-идентично.
 */
export function isV2OpenLoopsEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_OPEN_LOOPS, userId);
}
```

## Юнит A — сборщик + формат + порог (`services/open-loops.ts`)
```ts
import { prisma } from '../lib/prisma.js';
import { countOverduePending, listOverduePending } from './task-overdue.js';

export interface OpenLoops {
  overdueCount: number;
  overdueTitles: string[];       // топ-3 названия
  habitsActive: number;
  habitsUnchecked: number;
  uncheckedHabitNames: string[]; // топ-3 имени
  pendingText: string | null;    // confirmationText если PendingAction есть
}

/** READ-ONLY снимок открытых петель. todayStart — UTC-instant начала локального дня. */
export async function gatherOpenLoops(userId: string, todayStart: Date): Promise<OpenLoops> {
  const tomorrow = new Date(todayStart.getTime() + 86_400_000);
  const [overdueCount, overdueSample, habits, todayLogs, pending] = await Promise.all([
    countOverduePending(userId, todayStart),
    listOverduePending(userId, todayStart, 3),
    prisma.habit.findMany({ where: { userId, active: true }, select: { id: true, name: true } }),
    // сегодняшние ОТМЕЧЕННЫЕ привычки. Диапазон [todayStart, tomorrow) — устойчиво
    // к тому, хранит ли @db.Date инстант локальной полуночи или дату.
    prisma.habitLog.findMany({
      where: { userId, completed: true, date: { gte: todayStart, lt: tomorrow } },
      select: { habitId: true },
    }),
    prisma.pendingAction.findUnique({ where: { userId }, select: { confirmationText: true } }).catch(() => null),
  ]);
  const doneIds = new Set(todayLogs.map((l) => l.habitId));
  const unchecked = habits.filter((h) => !doneIds.has(h.id));
  return {
    overdueCount,
    overdueTitles: overdueSample.map((t) => t.title),
    habitsActive: habits.length,
    habitsUnchecked: unchecked.length,
    uncheckedHabitNames: unchecked.slice(0, 3).map((h) => h.name),
    pendingText: pending?.confirmationText ?? null,
  };
}

/** Чистый форматтер блока. null если всё закрыто (тогда блок не добавляем). */
export function formatOpenLoopsSection(l: OpenLoops): string | null {
  const parts: string[] = [];
  if (l.overdueCount > 0) {
    const more = l.overdueCount > l.overdueTitles.length ? ', …' : '';
    const names = l.overdueTitles.length ? ` (${l.overdueTitles.join(', ')}${more})` : '';
    parts.push(`просрочено ${l.overdueCount}${names}`);
  }
  if (l.habitsUnchecked > 0) {
    const names = l.uncheckedHabitNames.length ? ` (${l.uncheckedHabitNames.join(', ')})` : '';
    parts.push(`привычки ${l.habitsUnchecked}/${l.habitsActive} не отмечены${names}`);
  }
  if (l.pendingText) parts.push('ждёт подтверждение');
  if (parts.length === 0) return null;
  return `Открыто сейчас: ${parts.join('; ')}.`;
}

/** Порог проактивного нуджа (тюнится). */
export const OPEN_LOOP_OVERDUE_THRESHOLD = 4;
export const OPEN_LOOP_TOTAL_THRESHOLD = 6;
export function shouldNudgeOpenLoops(l: OpenLoops): boolean {
  const total = l.overdueCount + l.habitsUnchecked + (l.pendingText ? 1 : 0);
  return l.overdueCount >= OPEN_LOOP_OVERDUE_THRESHOLD || total >= OPEN_LOOP_TOTAL_THRESHOLD;
}
```

## Юнит B — блок-осознание (`v2-enrichment.ts`)
1. В `V2EnrichmentData` добавить `openLoops: string | null;` (рядом с `recentActivity`).
2. В `fetchV2EnrichmentData` Promise.all — добавить ветку (нужен `todayStart` юзера; **сверь, как сосед `buildScheduleConflict`/`countOverduePending`-вызов получает «сегодня» по таймзоне** — переиспользовать тот же tz→todayStart хелпер):
```ts
isV2OpenLoopsEnabled(userId)
  ? withTimeout(
      gatherOpenLoops(userId, todayStart).then((l) => formatOpenLoopsSection(l)),
      CROSS_DOMAIN_BUDGET_MS, null,
    ).catch(() => null)
  : Promise.resolve(null),
```
добавить `openLoops` в destructure + в возвращаемый объект.
3. В `buildV2EnrichmentBlock`: `if (data.openLoops) lines.push(data.openLoops);` (рядом с recentActivity).
**off** → ветка `Promise.resolve(null)` → `openLoops:null` → не пушится → байт-идентично.

## Юнит C — проактивный нудж (`v2-proactivity-engine.ts`)
1. `NudgeSource` union — добавить `| 'open_loop_pileup'` (последним).
2. `TEMPLATES` — `open_loop_pileup: { gentle: 'Накопилось: {{overdue}} просрочек, {{habits}} привычек не отмечено. Разгрести вместе?' }`.
3. `scoreSignificance` — `case 'open_loop_pileup': return 0.6;` (умеренно: actionable, но не срочно как commitment_due).
4. Детектор (зеркало `detectGoalHabitsStall` :730-745 — **сверь ТОЧНУЮ форму NudgeCandidate + поле дедупа/scopeKey**):
```ts
async function detectOpenLoopPileup(userId: string, todayStart: Date): Promise<NudgeCandidate[]> {
  if (!isV2OpenLoopsEnabled(userId)) return [];           // ранний флаг-гейт
  const l = await gatherOpenLoops(userId, todayStart).catch(() => null);
  if (!l || !shouldNudgeOpenLoops(l)) return [];
  return [{
    source: 'open_loop_pileup',
    payload: { overdue: l.overdueCount, habits: l.habitsUnchecked },
    toneHint: 'gentle',
    // + дедуп-поле как у соседей: scopeKey 'time:open_loops' ≤1/день
  }];
}
```
5. Зарегистрировать `detectOpenLoopPileup` в оркестраторе детекторов (где зовётся `detectGoalHabitsStall`); сверь, откуда детекторы берут `todayStart`/now.
**off** → детектор `[]` → ни одного кандидата → байт-идентично.

## Обработка ошибок
- `gatherOpenLoops` — внутр. вызовы best-effort (`countOverduePending`/`listOverduePending` уже try/catch; pending `.catch(()=>null)`); withTimeout(...,null) в enrichment; `.catch(()=>null)` в детекторе. Сбой → блок/нудж пропадает, ответ не падает.
- Read-only: 0 записей. Антифаб: всё из БД.

## ⚠️ TZ-внимание (был баг-дат)
`todayStart` ДОЛЖЕН быть тем же «началом локального дня юзера», что использует `countOverduePending` в проде (см. `assistant-service.ts:230` `todayDateOnly`). HabitLog-сегодня запрашивается диапазоном `[todayStart, todayStart+1д)` — устойчиво к @db.Date. It-тест ПРОВЕРЯЕТ: записать сегодняшний HabitLog → gather видит привычку как отмеченную (ловит TZ-сдвиг).

## Тесты
**Unit:** `isV2OpenLoopsEnabled` (флаг); `formatOpenLoopsSection` (просрочки+привычки+pending → строка; всё-пусто → null; >3 просрочек → «…»); `shouldNudgeOpenLoops` (≥4 просрочки→true; сумма≥6→true; 1-2 петли→false). Структурный: `open-loops.ts` существует с 4 экспортами; `v2-enrichment.ts` имеет `isV2OpenLoopsEnabled`+`gatherOpenLoops`+`openLoops`; `v2-proactivity-engine.ts` имеет `'open_loop_pileup'` в union+TEMPLATES+score+`detectOpenLoopPileup` с ранним флаг-гейтом.
**Integration (`open-loops.it.test.ts`):**
- Создать юзера + 3 просроченные задачи (date<today, completed:false) + 4 активные привычки, 2 с сегодняшним completed-логом → `gatherOpenLoops`: overdueCount=3, habitsUnchecked=2, habitsActive=4, имена непустые. `formatOpenLoopsSection` непустой.
- TZ: записать сегодняшний HabitLog для привычки X → X НЕ в uncheckedHabitNames (ловит TZ-сдвиг).
- PendingAction есть → pendingText непустой; нет → null.
- `shouldNudgeOpenLoops` на этом наборе (3 просрочки+2 привычки=5 <6, просрочек 3<4 → false; добавить ещё → true).
- cross-user изоляция (чужие задачи/привычки не считаются).

## Декомпозиция (файлы)
| Файл | Изменение |
|------|-----------|
| `src/lib/feature-flags.ts` (+test) | `isV2OpenLoopsEnabled` |
| `src/services/open-loops.ts` (new) + `.test.ts` | gather + format + порог |
| `src/services/v2-enrichment.ts` | блок-осознание (type+Promise.all+push) |
| `src/services/v2-proactivity-engine.ts` | `open_loop_pileup` source+template+score+детектор+register |
| `src/services/open-loops-wiring.test.ts` (new) | структурный гард врезок |
| `src/services/open-loops.it.test.ts` (new) | интеграция (реальные счётчики + TZ + cross-user) |

## Rollout
Коммит-на-шаг (atomic TDD). Полный verify + независимое ревью (фокус: off=байт-идентично обе врезки; read-only; антифаб — счётчики реальные; TZ-корректность HabitLog-сегодня; дедуп нуджа; порог вменяем). `push`/`deploy`/`FEATURE_V2_OPEN_LOOPS=all` — ТОЛЬКО по слову Berik.

## Граница (честно)
- 3 сигнала (просрочки/привычки-сегодня/pending). Предстоящие события (24ч) НЕ тут — частично у schedule-conflict; можно добавить fast-follow.
- `PendingAction` = 0/1 (userId @id) → «ждёт подтверждение» бинарно, не список.
- Порог 4/6 — стартовый; тюнится. Нудж дедуплен ≤1/день.
- НЕ авто-действие (не закрывает петли сам) — только осознание + предложение. Закрытие — через обычные инструменты по согласию.
