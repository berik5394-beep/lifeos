# Память ДР (ключевые даты) — Дизайн-спека

> Клин «Память отношений + обещаний», под-срез (б): ключевые даты.
> Chief-of-Staff мост #2 (Люди = актив). Berik одобрил дизайн 2026-06-05.

## Цель (одно предложение)
Бот помнит дни рождения людей и **проактивно** напоминает заранее — «Завтра ДР у Ахмета (исполнится 30) — поздравишь?» — а также отвечает на вопрос «у кого скоро ДР?».

## Границы (scope)
- SERVER-only (`packages/server`). Мозг на бэке → авто всем по деплою.
- Флаг-гейт `isV2BirthdayEnabled`; при OFF поведение **байт-идентично** текущему.
- READ-ONLY кроме одной записи: `set_birthday` пишет **только** `Entity.attributes` (память, не деньги). Ноль денежных записей.
- Подход A (одобрен): источник ДР = инструмент `set_birthday`, который агент зовёт сам — и при явной просьбе, и при упоминании даты вскользь. Горячий путь извлечения сущностей НЕ трогаем.
- НЕ в этом срезе: импорт ДР из Google/контактов (отдельный большой срез); типы людей; каденс контакта (уже построен — `extractFrequencyPatterns`+`detectStaleEntity`).

## Хранение
- `Entity.attributes.birthday` — JSON-поле внутри существующего `attributes Json` (**миграция не нужна**).
- Формат: `{ day: number (1-31), month: number (1-12), year?: number }`.
- `year` опционален (нужен только для возраста). Отсутствие года = ДР без возраста.
- Только для `Entity.type === 'person'`.

## Компоненты

### 1. Чистые хелперы — `src/services/birthday/types.ts`
Все чистые, без I/O, юнит-тестируемы. Не бросают (возвращают null/[]).

- `export interface Birthday { day: number; month: number; year?: number }`
- `parseBirthday(input: unknown): Birthday | null`
  - Принимает уже-структурный объект `{day,month,year?}` ИЛИ строку.
  - Строки: «12 мая», «12.05», «12.05.1994», «2026-05-12», «May 12». Русские месяцы (полные + сокр.).
  - Валидация: month 1-12, day 1-31 (с учётом месяца: апр≤30, фев≤29). year — 1900..2100 или undefined.
  - null на мусор/вне диапазона.
- `daysUntilBirthday(b: Birthday, now: Date): number`
  - Дней до ближайшего наступления (день/месяц), игнорируя год. 0 = сегодня, 1 = завтра.
  - 29 фев в невисокосный год → считать как 1 марта.
  - Работает через границу года (ДР 3 янв при now 30 дек → 4).
- `ageOnNextBirthday(year: number | undefined, now: Date): number | null`
  - Сколько исполнится на ближайший ДР. null если year отсутствует.
- `upcomingBirthdays(persons: PersonBirthday[], now: Date, windowDays: number): UpcomingBirthday[]`
  - `PersonBirthday = { name: string; birthday: Birthday }`
  - `UpcomingBirthday = { name: string; daysUntil: number; age: number | null }`
  - Фильтр `daysUntil <= windowDays`, сортировка по `daysUntil` возр.
- `formatBirthdayNudge(name: string, daysUntil: number, age: number | null, tone: NudgeTone): string`
  - `tone` из существующего union тонов движка (gentle/curious/supportive…).
  - «Сегодня ДР у {name}…» / «Завтра ДР у {name}…»; «(исполнится {age})» если age!=null; хвост-призыв «поздравишь?».

### 2. Инструмент — `src/tools/set-birthday.ts`
- Через `defineTool` (как `remember-entity`). Имя `set_birthday`, **needsConfirm: false**, `category:'memory'`, `sideEffects:'write'`.
- `aliases` (модель часто шлёт синонимы): `{ name:'person', personName:'person' }`.
- Вход (zod, каждое поле `.describe()` с примерами «у Ахмета ДР 12 мая»):
  `{ person: z.string().min(1).max(120); day: z.number().int().min(1).max(31); month: z.number().int().min(1).max(12); year: z.number().int().min(1900).max(2100).optional() }`.
- Логика handler (`ctx.userId`):
  1. `parseBirthday({day,month,year})` → null ⇒ вернуть `{ message: 'Не понял дату ДР' }`, ничего не писать.
  2. `getEntityGraph().upsertEntity(ctx.userId, { type:'person', name:input.person, attributes:{ birthday:{day,month,year?} }, importance:5 })` — **upsertEntity мержит attributes** (см. types.ts:35 «merges attributes»), прочие ключи сохраняются. Это и резолв-по-имени, и запись разом.
  3. Отчёт активности (как другие write-инструменты, M1) — паттерн `captureActivity`/`runRegistryTool` уже оборачивает write-инструменты; доп. ручной хук НЕ нужен, т.к. инструмент идёт через `runRegistryTool` (досверить: hook [A] в runRegistryTool уже логирует все реестровые вызовы).
- Возврат: `{ message: 'Запомнил: ДР {person} — {day}.{month}[.{year}]', entityId }`.
- Регистрация: добавить в `ALL_TOOLS` в `src/tools/index.ts` (попадёт в exec-проекции, т.к. needsConfirm:false).

### 3. Проактивный детектор — `src/services/v2-proactivity-engine.ts`
- `NudgeSource` union: добавить `'birthday_upcoming'`.
- `TEMPLATES`: блок `birthday_upcoming` с вариантами под тон (gentle/curious/supportive).
- `scoreSignificance`: кейс для `birthday_upcoming` (значимость растёт при daysUntil=0/1 и высокой importance человека; ≥ floor gate3=0.6, чтобы доставлялся).
- `async function detectBirthday(userId): Promise<NudgeCandidate[]>`:
  - РАННИЙ `const { isV2BirthdayEnabled } = await import('../lib/feature-flags.js'); if(!isV2BirthdayEnabled(userId)) return [];` (как detectObligationDue — гейт детектора, важно для off=identical).
  - Прочитать person-entities с непустым `attributes.birthday` (Prisma `entity.findMany` where type='person' + attributes path; либо best-effort all-persons + фильтр в памяти).
  - Для каждого `daysUntilBirthday` ≤ WINDOW (=1) → кандидат `{ source:'birthday_upcoming', significance:0, entityId, payload:{name,daysUntil,age,importance}, toneHint:'gentle' }`; `significance = scoreSignificance(cand)`.
  - try/catch → `[]` с `console.warn` (паттерн прочих детекторов).
- Регистрация в `detectCandidates`/`runForUser` Promise.allSettled([... detectBirthday(userId)]).
- Дедуп доставки — существующий механизм движка (источник+entity недавно доставлен). Окно 2 дня (daysUntil 0 и 1) ⇒ естественно раз в год.

### 4. Enrichment врезка — `src/services/v2-enrichment.ts`
- `formatBirthdaySection(rows): string | null` — «Скоро ДР: Ахмет — завтра; Серик — через 3 дня». null если пусто.
- Сбор за флагом: `isV2BirthdayEnabled(userId) ? withTimeout(buildBirthdayRows(userId), 500, null) : null` в существующем Promise.all блоке сбора (grep место, паттерн obligations/relationship).
- Окно enrichment шире детектора (например 7 дней), чтобы на вопрос «у кого скоро ДР?» был ответ. WINDOW_ENRICH=7.

### 5. Флаг — `src/lib/feature-flags.ts`
- `isV2BirthdayEnabled(userId: string): boolean` — копия формы `isV2AxesEnabled`: env `FEATURE_V2_BIRTHDAY`, значения `all|true` (всем), `none|false`/пусто (никому), `user-<id>` (адресно).
- Юнит-кейс в `feature-flags.test.ts`.

## Тесты
- **Pure-юнит** (`birthday/types.test.ts`): parseBirthday (валид строки рус/числа/ISO; мусор→null; апр-31→null; фев-29 ок); daysUntilBirthday (сегодня=0, завтра=1, через границу года, 29 фев в невисокосный→как 1 мар); ageOnNextBirthday (с годом/без); upcomingBirthdays (фильтр+сорт); formatBirthdayNudge (с age/без, сегодня/завтра).
- **Поведенческий** (`birthday.it.test.ts`, тест-БД харнес, zero vi.mock): создать юзера+person-entity; вызвать set_birthday-логику → attributes.birthday записан; detectBirthday находит entity с ДР завтра, НЕ находит с ДР через 30 дней; флаг OFF → detectBirthday=[]; cross-user: B не видит ДР из A.
- **Структурный** (readFileSync+grep): флаг есть; `birthday_upcoming` в NudgeSource + TEMPLATES + scoreSignificance + detectCandidates; detectBirthday имеет ранний флаг-гейт; enrichment врезка за флагом; set_birthday в ALL_TOOLS; exhaustiveness-тест union проходит.
- Baseline вся сюита зелёная (~2383 unit + 45 it на момент старта); `tsc` чисто каждый таск; zero vi.mock; `createAnthropic()` если понадобится (тут не нужен — парсинг даты делает агент, хелпер чистый).

## Money-safety
- Фича не пишет деньги. Единственная запись — `Entity.attributes.birthday`. Структурный тест: в `services/birthday` нет `prisma.*.create/update/delete` (запись делает только инструмент через entity-graph upsert, по образцу remember-entity).

## Rollout
- Коммит на каждый шаг (heredoc) с трейлером `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- push / deploy / выставление флага — **ТОЛЬКО по явному слову Berik**. По правилу «всё включаем сразу для всех» флаг сразу `all` (после ревью).
- SMOKE (Telegram): «запомни, у Ахмета ДР завтра» → бот подтверждает; «у кого скоро ДР?» → «Ахмет — завтра»; на следующий тик проактивности — нудж «Завтра ДР у Ахмета — поздравишь?».

## Открытые мелочи (решены явно, не плейсхолдеры)
- WINDOW детектора = 1 день (нудж за день + в день). WINDOW enrichment = 7 дней.
- Возраст показываем только если есть `year`.
- 29 фев → 1 мар в невисокосный (детермінированно).
- set_birthday needsConfirm:false (сразу пишет, как sibling memory-инструменты).
