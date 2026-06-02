# Движок пересечения — Срез 1: «День перегружен» (время-в-день)

**Дата:** 2026-06-02
**Статус:** дизайн одобрен Berik (ждёт ревью спеки)
**Тип:** первый вертикальный срез общего движка пересечения (north-star, interconnection_map.md §2a). Server-only.

## 1. Видение и этот срез

Деньги-коуч уже доказал паттерн в проде: `ёмкость ресурса vs сумма обязательств → не хватает → защити главную → «+Δ или опоздаешь»` (вживую: расход 100к → темп упал → коуч сразу +102420/мес). **Общий движок = тот же паттерн для ЛЮБОГО ресурса.** Строим вертикальными срезами, по ресурсу за раз. **Срез 1 = ВРЕМЯ-В-ДЕНЬ** («день перегружен»), пример Berik: *«6 задач ~7ч, свободно 4ч + встреча → не влезает, что переносим?»*. Доказывает движок на ВТОРОМ ресурсе.

**Философия Друга (Berik, подтверждено):** ИИ сам прикидывает (часы задачи + свободное время), НЕ пристаёт вопросами; в момент конфликта уточняет «хватит ли времени?» — и ответ его учит. Та же петля, что у денег/осей.

## 2. Принцип (деньги и время — одна форма)

`computeCapacityFit(capacity, items[{demand, importance}])`: сложить спрос, сравнить с ёмкостью; не влезает → защитить важные (по importance), мелкие → в overflow («перенести»). Деньги: items=цели, demand=нужно/мес, importance=размер цели. Время-день: items=задачи, demand=часы, importance=приоритет. **Одно ядро, тонкие адаптеры.**

## 3. Компонент A — чистое ядро `computeCapacityFit` (ресурсо-агностично)

Новый чистый модуль `services/capacity-fit.ts`. Без БД/AI.

```ts
export interface CapacityItem { label: string; demand: number; importance: number; }
export interface CapacityFitInput { capacity: number; items: CapacityItem[]; }
export type CapacityStatus = 'fits' | 'tight' | 'overloaded';
export interface CapacityFit {
  status: CapacityStatus;
  capacity: number;
  totalDemand: number;
  overBy: number;            // max(0, totalDemand − capacity)
  fit: CapacityItem[];       // влезают (greedy по importance desc)
  overflow: CapacityItem[];  // не влезают → кандидаты на перенос
}
```

Логика: `totalDemand = Σ demand`. Greedy: сорт по `importance` desc, набираем в `fit` пока влезает в `capacity`, остальное → `overflow`. Статус: `overloaded` если `totalDemand > capacity`; `tight` если `0.85·capacity ≤ totalDemand ≤ capacity`; иначе `fits`. `overBy = max(0, totalDemand − capacity)`. Краевые: пустой items → `fits`; capacity ≤ 0 → всё в overflow, `overloaded`. Чистое, юнит-тест.

## 4. Компонент B — адаптер ВРЕМЯ-В-ДЕНЬ

Новый `services/day-load.ts`.

- **Спрос:** невыполненные задачи юзера на сегодня (локальная дата по `User.timezone`). `demand = estimatedMinutes` (поле УЖЕ есть). `importance` = `Task.importance` если задан (целое), иначе маппинг `priority`: critical/high→3, medium→2, low→1. `label` = title.
- **Ёмкость:** `availableMinutesToday` — чистый хелпер (рядом с `_slots.timeDiff`): свободные минуты сегодня от `max(09:00, текущее_локальное_время)` до `20:00`, МИНУС события `CalendarEvent` сегодня (как `findFreeSlots`, но окно стартует с «сейчас» — исключает прошедшее). Окно 09:00–20:00 = дефолт (как в `_slots`); опц. настройка окна — non-goal v1.
- `gatherDayLoad(userId, now)` → `{ capacity, items }` → `computeCapacityFit`.
- **Строка** `describeDayLoad(fit, now)` (общая для потребителей, как `describePortfolioPace`): `overloaded` → «На сегодня задач на ~Xч, свободно ~Yч{ + встреча в HH:MM}. Не всё влезет — перенесём «{overflow[0].label}» на завтра? И хватит ли времени на «{fit[0].label}»?»; `tight` → мягкое «впритык»; `fits` → null (молчим). null когда нет задач/оценок.

## 5. Компонент C — ИИ-оценка часов задачи (haiku)

Новый `services/estimate-task-minutes.ts`: при создании задачи без `estimatedMinutes` — haiku оценивает «сколько среднему человеку надо на это» по title (+category). Чистый парсер `parseMinutes` (число, клампы 5..480, дефолт 30 при сбое) + best-effort haiku (createAnthropic, на сбой → дефолт). Хук: в пути создания задачи (`create_task` tool / route) — если `estimatedMinutes == null`, оценить (fire-and-forget, не блокирует ответ; апдейт задачи фоном). НЕ спрашивает юзера.

## 6. Компонент D — проактивная подача + «хватит ли времени?» + обучение

Потребители зовут `gatherDayLoad`→`computeCapacityFit`→`describeDayLoad`:
- **(v1 обязательно) Реактивно после добавления задачи на сегодня:** хук `maybeDayLoadLine(userId, now)` в пути `create_task` (точка схождения, как `maybeSavingsCoachLine` для add_expense) — если новая задача делает день `overloaded` → дописать строку. Гейт: только `overloaded` (не `tight`/`fits`), ≤1/день дедуп Insight `scopeKey:'time:day_load', source:'day_load'` (как реактив денег: дедуп против СВОИХ).
- **(опц. в срезе / иначе fast-follow) Утренний брифинг:** та же строка в `get_today`/reflector, если `overloaded`.
- **«Хватит ли времени?» + обучение (v1-минимум):** строка задаёт вопрос; если юзер поправит время конкретной задачи в ответ («отчёт займёт 3 часа») — обычный путь правки задачи обновляет `estimatedMinutes` (M1 уже ловит правки). Авто-улучшение глобальных priors ИИ — non-goal v1.

## 7. Данные / миграции / настройки

- **Без миграции:** `Task.estimatedMinutes Int?` уже есть.
- **Без новых настроек:** ёмкость из дефолтного окна 09:00–20:00 (как `_slots`) + календарь + «сейчас». Опц. персональное окно — non-goal v1 (fast-follow).
- Флаг `FEATURE_V2_DAY_LOAD` (`isV2DayLoadEnabled`, форма «all»/user-X как у сиблингов; off = байт-в-байт).

## 8. Деньги НЕ трогаем

`computePortfolioPace` (деньги, в проде) остаётся как есть. `computeCapacityFit` — новое ядро для времени. Сведение денег на общее ядро — отдельный поздний рефактор (walk-don't-leap: не трогаем живой денежный путь в первом срезе времени).

## 9. Переиспользование (один мозг, не 28×28)

`findFreeSlots`/`timeDiff`/`_slots` (ёмкость), `Task.estimatedMinutes`/`priority`/`importance` (спрос), reflector/`get_today` (подача), M1-capture (правка задачи → обновление оценки), proactivity-engine + Insight dedup (доставка), createAnthropic+MODELS.haiku (оценка). Деньги-коуч = эталон структуры.

## 10. Тестирование

- **Pure unit `capacity-fit.test.ts`:** fits/tight/overloaded; overBy; greedy по importance (защищает важные, мелкие в overflow); пусто→fits; capacity≤0→overloaded; границы без NaN.
- **Pure unit `availableMinutesToday`:** окно минус события; старт с «сейчас» (прошедшее исключено); нет событий → полное окно; вечер (now>20:00) → 0.
- **Pure unit `parseMinutes`:** число/клампы/дефолт.
- **Structural:** `maybeDayLoadLine` зовёт gather+fit+describe + дедуп `time:day_load`; create_task путь оценивает estimatedMinutes когда null; `describeDayLoad` null на fits.
- Базовая сюита (2103) зелёная, tsc 0, zero vi.mock.

## 11. Non-goals (осознанно)

- Персональное окно-настройка (будни/выходные) — fast-follow.
- Авто-обучение priors ИИ-оценки из фидбека — позже (v1 ловит правку конкретной задачи).
- Неделя/год/энергия — следующие срезы (тот же паттерн).
- Авто-перенос задач (бот сам двигает) — только ПРЕДЛАГАЕТ; перенос руками/подтверждением.
- Сведение денег на общее ядро — поздний рефактор.

## 12. Файлы

- Create `services/capacity-fit.ts` (+test) — чистое ядро.
- Create `services/day-load.ts` (+test) — адаптер: gatherDayLoad/describeDayLoad + `availableMinutesToday` (или в `_slots.ts`).
- Create `services/estimate-task-minutes.ts` (+test) — haiku-оценка + parseMinutes.
- Modify `lib/feature-flags.ts` — `isV2DayLoadEnabled`.
- Modify create_task путь (`tools/create-task.ts` / route) — оценка estimatedMinutes если null (fire-and-forget) + `maybeDayLoadLine` хук.
- Modify `get_today`/reflector — дневная строка day_load (опц. в этом срезе или fast-follow).
- structural тесты.
