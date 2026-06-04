# CashSnapshot → Runway «на сколько хватит» — Design Spec

**Дата:** 2026-06-04
**Автор:** Berik + Claude (brainstorming)
**Статус:** одобрено Berik (все 4 секции + нюанс Секции 2)
**Скоуп:** SERVER-only (`packages/server`). READ-only кроме одного confirm-гейтнутого write (`set_balance`).

## Проблема

Runway-движок отвечает «на сколько хватит денег» из `cashOnHand = Σincome − Σexpense` (накопленный net за всё время). Но юзер часто **не записывает доходы** → Σincome≈0 → `cashOnHand` бессмысленный/отрицательный → бот честно отвечает «доход не записан, сколько у тебя на счету?» вместо числа. Нужна **точка отсчёта**: юзер один раз называет текущий баланс, runway считает вперёд от него.

## Решение (Подход A)

Отдельная модель `CashSnapshot` + write-инструмент `set_balance`. Runway берёт **последний** снапшот как якорь и проецирует вперёд по темпу трат. Проекция «честный худший случай»: *если больше не заработаешь — баланс хватит на N; если доход записан — нетится, хватит дольше*.

Изолированно, SSOT, история капитала бесплатно (тренд потом). Паттерн 1:1 со всеми кросс-домен мостами: своя модель + флаг-гейт врезка.

## Секция 1 — Модель данных + флаг

```prisma
model CashSnapshot {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  balance   Float          // сколько на счету со слов юзера
  asOf      DateTime @db.Date   // на какую дату (локальный день юзера)
  createdAt DateTime @default(now())
  @@index([userId, asOf])
}
```
+ relation `cashSnapshots CashSnapshot[]` в модели `User`.

**Миграция:** руками, т.к. `.env` указывает на ПРОД. Шаги: правка `schema.prisma` → SQL `CREATE TABLE "CashSnapshot" (...)` + индекс (идемпотентно, `IF NOT EXISTS`) → `prisma generate`. БЕЗ `migrate dev`.

**Флаг:** `isV2RunwayBalanceEnabled(userId)` в `src/lib/feature-flags.ts` (env `FEATURE_V2_RUNWAY_BALANCE`, форма `all|true|none|false|user-X` — копия `isV2AxesEnabled`) + юнит-кейс в `feature-flags.test.ts`. Гейтит И регистрацию инструмента, И якорь в runway. Off ⇒ байт-идентичное старое поведение (all-time net).

## Секция 2 — Интеграция в runway

**Чистый хелпер** (`runway/types.ts`):
```ts
export function computeAnchoredCash(input: {
  balance: number;
  expensesSince: number;
  incomesSince: number;
}): number {
  return input.balance - input.expensesSince + input.incomesSince;
}
```

**`buildRunway`** (`runway/runway.ts`): если `isV2RunwayBalanceEnabled(userId)` И есть последний `CashSnapshot` (по `asOf desc, createdAt desc`) → вместо all-time net:
- `expensesSince = Σ expense.amount where date > asOf`
- `incomesSince  = Σ income.amount  where date > asOf`
- `cashOnHand = computeAnchoredCash({ balance, expensesSince, incomesSince })`

Расходы/доходы в **день** `asOf` НЕ считаем (считаем «уже отражены в названном балансе» — не двоим). Строго `date > asOf`.
Нет снапшота / флаг off → текущий fallback `(Σincome − Σexpense)`.

**Нюанс (одобрен):** сейчас runway возвращает `null` при `healthy`/`cash_positive` (молчит, когда денег с запасом — он проактивный «ноет когда мало»). Но **при наличии снапшота** юзер сам спросил → число нужно всегда. Поэтому: **если использован якорь-снапшот, runway отдаёт `insightText` для ЛЮБОГО статуса кроме `no_data`**; `healthy`/`cash_positive` формулируются позитивно («хватит на ~N мес, спокойно»). Без снапшота — старое silent-when-healthy поведение не трогаем.

Реализация: `describeRunway` получает флаг `hasAnchor: boolean`; при `hasAnchor` рендерит позитивную строку для healthy/cash_positive вместо `null`. Гейт `buildRunway` (ранний `return null`) пропускает healthy/cash_positive ТОЛЬКО когда `!hasAnchor`.

## Секция 3 — Инструмент `set_balance` + стимул к доходам

`src/tools/set-balance.ts`, паттерн 1:1 с `add-income.ts`:
- `name: 'set_balance'`, `category: 'finance'`, `needsConfirm: true`, `sideEffects: 'write'`.
- `aliases: { amount: 'balance', sum: 'balance', cash: 'balance', счёт: 'balance', на_счету: 'balance' }`.
- `schema: z.object({ balance: z.number().positive().max(1_000_000_000), asOf: z.string().optional() })`.
- handler: TZ-aware «сегодня» (`localDayStartUTC(getUserTimezone)`); `prisma.cashSnapshot.create`. Ответ — подтверждение + сразу проекция: после создания зовёт `buildRunway(userId)` и добавляет его строку, если есть. Реюз, без новой логики.
- Регистрация в `tools/index.ts` за флагом `isV2RunwayBalanceEnabled` (как другие флаг-гейтнутые инструменты).
- examples: `['на счету 500000', 'у меня 350 тысяч на карте', 'баланс 1.2 млн']`.

**Стимул к доходам:** хвост в `describeRunway`, когда `monthlyIncome <= 0` (доход не записан): `« — считаю без учёта дохода, записывай зарплату → посчитаю точнее»`. Автоматически нетится, как только доход появится. Отдельного наджера нет (YAGNI).

## Секция 4 — Тесты

- **Pure-unit** (`runway/types.test.ts`): `computeAnchoredCash` (норма; нет трат `expensesSince=0`; траты>баланса → отрицательный кэш → status underwater; доход нетится). `describeRunway` с `hasAnchor=true` для healthy → непустая позитивная строка; income-хвост при `monthlyIncome<=0`.
- **Поведенческий** (`runway/cash-snapshot.it.test.ts`, тест-БД харнес): юзер + `CashSnapshot(balance, asOf)` + Expense после asOf → `buildRunway` даёт верный анкер-кэш и число; снапшот в день asOf + расход в тот же день → расход НЕ вычтен; без снапшота → fallback all-time net; cross-user A не видит снапшот B.
- **Структурный**: флаг существует + гейтит; `set_balance` зарегистрирован за флагом; no-write guard на read-пути `buildRunway` (ноль `prisma.*.create/update/delete/upsert/$executeRaw` в runway.ts); врезка `formatRunwaySection` не изменена по сигнатуре.
- **Money-safety**: `set-balance.test.ts` — `needsConfirm:true`, `sideEffects:'write'`; запись только после явного «да» (как `money-safety.test.ts` для add_income).

Baseline: 2295 unit + 25 it зелёные; tsc чисто каждый таск.

## Money-safety

`CashSnapshot` — **референсная точка**, НЕ денежный ledger (не Income/Expense). Не влияет на суммы трат/доходов, только на якорь runway-чтения. Запись только за `needsConfirm` (явное «да»). off=байт-идентично.

## Rollout

Коммит на шаг (trailer `Co-Authored-By: Claude Opus 4.8 (1M context)`). После независимого ревью — push + deploy + флаг `FEATURE_V2_RUNWAY_BALANCE=all` (стандартное правило «всё включаем сразу для всех»). SMOKE: боту «на счету 500000» → подтверждение + проекция; затем «на сколько мне хватит денег» → число дней/месяцев.

## Не в скоупе (YAGNI)

- Мобильный экран баланса / тренд капитала (потом, при сборке приложения).
- Авто-определение баланса из банковских SMS (отдельная интеграция).
- Множественные счета (один агрегированный баланс пока достаточно).
