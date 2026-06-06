# Real-Time Foundation — телефон → сервер → мозг привязаны к настоящему локальному времени

**Дата:** 2026-06-06
**Статус:** дизайн на ревью Berik
**Охват (выбор Berik):** телефон + сервер ВМЕСТЕ, один срез end-to-end под релиз.

## Цель (одно предложение)
На релизе телефон сообщает серверу СВОЙ настоящий IANA-пояс каждым запросом; сервер
хранит его в `User.timezone` (авто-обновление при перелёте), и ИИ + все инструменты +
v2-мозг работают в **настоящем локальном «сейчас» пользователя** — где бы он ни был.

## Проблема (доказано аудитом кода)
- `User.timezone` существует (`@default("Asia/Almaty")`), но **никто никогда не пишет в
  него правду устройства** → застрял на дефолте для всех.
- `getTimeOfDay()` (`jarvis-prompt.ts:92-98`) считает час от `new Date().getHours()` =
  **UTC сервера Railway**, игнорируя даже сохранённый tz. Ты в Алмате 19:00 → сервер
  UTC 14:00 → бот думает «день», а у тебя «вечер». Живой баг.
- LLM **не имеет часов** — знает время только из впрыснутого. Сейчас впрыск неверный.

Индустриальный стандарт (реальные проекты): телефон шлёт **имя IANA-пояса** заголовком
(не оффсет — оффсет ломает DST), сервер хранит UTC + пояс, конвертит на краях; ИИ-агенты
(OpenCLAW и др.) впрыскивают в системный промпт блок «Current Date & Time» с
**отформатированными** датой+временем+поясом и инструкцией сверять относительные даты.

## Архитектура (3 слоя, «мозг тоже»)
```
ТЕЛЕФОН (Expo)                СЕРВЕР (Fastify)                  МОЗГ / ИИ
getDeviceTimezone()  ──X-Timezone──▶ preHandler-хук:           getTimeOfDay(tz) [fix]
(expo-localization,   header каждый  validate + update          + впрыск в промпт:
 синхронно, свежо      запрос         User.timezone ON CHANGE   «СЕЙЧАС: пятница,
 каждый запрос →                      (in-mem cache, без         6 июня 2026, 19:42 —
 travel-safe)                         write-storm)               вечер. Пояс Asia/Almaty»
                                            │                    + инструкция сверять
                                            ▼                      сегодня/завтра/вчера
                                    User.timezone = ЕДИНЫЙ
                                    источник правды
                                            │
                                    getUserTimezone(userId)
                                            │
                              ┌─────────────┼─────────────┐
                         все инструменты  проактив     v2-enrichment
                         (create_task/    (утро/вечер/  (recordEvent validAt,
                          event уже на    «не успеешь»)  врезки) — UTC-инстант
                          localDateOnlyUTC(tz),                   хранит, локаль
                          tz теперь НАСТОЯЩИЙ)                    рендерит по tz
```

## Компоненты

### СЕРВЕР (основная работа — там живёт мозг)

**S1. `lib/tz.ts` — чистые хелперы (добавить):**
- `export const DEFAULT_TZ = 'Asia/Almaty'` — единый фолбэк (унифицирует разнобой
  `'UTC'`/`'Asia/Almaty'`).
- `isValidIanaTz(tz: string): boolean` — проба через `Intl.DateTimeFormat(undefined,{timeZone})`
  в try/catch (валидный пояс не бросает).
- `localNowString(tz, at?): string` — `Intl.DateTimeFormat('ru-RU',{timeZone:tz, weekday,
  day, month, year, hour, minute})` → «суббота, 6 июня 2026, 19:42». Переиспользует
  существующий `safeTz`.

**S2. `lib/feature-flags.ts`:** `isV2RealtimeEnabled(userId)` (env `FEATURE_V2_REALTIME`,
форма `all`/`user-X`/`none`), зеркало существующих флагов. **off = байт-идентично.**

**S3. `middleware/tz-capture.ts` (новый) + проводка в `index.ts`:** preHandler-хук ПОСЛЕ
auth (где `request.userId` уже стоит, `middleware/auth.ts:20`):
- читает `request.headers['x-timezone']`; если нет — ничего (Telegram/др. каналы);
- early-return если `!isV2RealtimeEnabled(userId)` → off байт-идентично;
- in-memory `Map<userId, lastTz>` cache: пишем `prisma.user.update({timezone})` **только
  если** header валиден (`isValidIanaTz`) И отличается от cache → нет write-storm;
- best-effort try/catch: сбой НИКОГДА не блокирует запрос.

**S4. `ai/jarvis-prompt.ts` — fix времени + впрыск (CRITICAL, прод-промпт):**
- Сигнатура **`getTimeOfDay(tz?: string, d = new Date())`**: если `tz` передан →
  `localHour(tz)`; если НЕ передан → старый `d.getHours()`. Ключ к байт-идентичности:
  **off-путь зовёт `getTimeOfDay()` без tz** (старое поведение), on-путь — `getTimeOfDay(tz)`.
- `buildJarvisPrompt` принимает в opts `nowTz?: string` (ставится ТОЛЬКО когда флаг ON).
  Оба вызова (`core()` на `:267`, `renderContext()` на `:158`) зовут
  `getTimeOfDay(opts.nowTz)` — при off `nowTz===undefined` → старая ветка → байт-идентично.
- **Когда `nowTz` задан (флаг ON):** в `core()` впрыснуть блок
  `СЕЙЧАС: ${localNowString(nowTz)} — ${getTimeOfDay(nowTz)}. Пояс: ${nowTz}.` +
  инструкцию «При словах сегодня/завтра/вчера — сверяйся с этим, не выдумывай».
- **Когда `nowTz` не задан (флаг OFF):** без блока, `getTimeOfDay()` по серверному
  времени → байт-идентично прежнему промпту.

**S5. `assistant-service.ts`:** проверить `isV2RealtimeEnabled(userId)`; если ON —
передать `nowTz: tz` (уже резолвится на `:75`) в opts `buildJarvisPrompt` (`:293`); если
OFF — `nowTz` не передавать. Тот же флаг гейтит и хук S3 (off = ничего не пишет).

### ТЕЛЕФОН (маленький кусок — телефон лишь кормит сервер правдой)

**M1.** добавить зависимость `expo-localization` (под SDK 54). Новый
`apps/mobile/services/device-tz.ts`: `getDeviceTimezone(): string` →
`Localization.getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
?? 'UTC'`. **Синхронно** → можно звать на каждый запрос, всегда свежо (перелёт без
AppState-слушателя).

**M2.** `apps/mobile/services/api.ts:133-142` (сборка заголовков fetch-обёртки) — после
блока Authorization добавить `headers['X-Timezone'] = getDeviceTimezone();` → уходит на
**каждый** запрос.

## Поток данных (travel-кейс)
1. Юзер в Алмате: телефон шлёт `X-Timezone: Asia/Almaty` → хук пишет (если изменилось).
2. Прилетел в Стамбул: ОС телефона сама ставит `Europe/Istanbul` → следующий запрос шлёт
   новый пояс → хук обновляет `User.timezone` → весь мозг/инструменты сразу в новом «сейчас».
3. Момент (instant) всегда UTC; локаль рендерится по `User.timezone` только на краях.

## Флаг / rollout
`FEATURE_V2_REALTIME`: off=байт-идентично (хук no-op, `getTimeOfDay` старый, без блока
СЕЙЧАС). Шипим тёмным → `user-<berik>` → проверка в Telegram (бот скажет верное время
суток) → `all` — **по явному слову Berik.** Мобайл-часть уезжает со следующей APK-сборкой;
сервер живёт раньше и уже чинит баг для Telegram-тестов.

## Обработка ошибок / краевые
- Невалидный `X-Timezone` → игнор, хранимый tz не трогаем.
- Сбой хука → best-effort, запрос не блокируется.
- Telegram/др. без header → используется хранимый `User.timezone` (дефолт Almaty) → всё
  равно получает fix `getTimeOfDay` + блок СЕЙЧАС.
- DST → решается именем IANA автоматически.
- `getDeviceTimezone` фолбэк-цепь → 'UTC' если всё пусто.
- Write-storm → отсечён in-memory cache (пишем только на смену).

## Тестирование (zero vi.mock, реальный путь)
- `lib/tz`: `isValidIanaTz` (валид/невалид); `localNowString` (Almaty формат; DST-пояс);
  **регресс-тест бага**: `getTimeOfDay('Asia/Almaty', 14:00Z)` → `вечер`, НЕ `день`.
- `feature-flags`: `isV2RealtimeEnabled` (all/user-X/none/off).
- `tz-capture` хук — поведенческий .it.test (реальный test-app + prisma): header →
  `User.timezone` обновлён; тот же tz → нет записи (cache); невалид → игнор; флаг off →
  no-op; cross-user изоляция.
- `jarvis-prompt`: флаг ON → промпт содержит «СЕЙЧАС» + верное локальное; флаг OFF →
  байт-идентично прежнему (нет блока, старый time-of-day).
- mobile `device-tz`: `getDeviceTimezone` → IANA / фолбэк.

## Порядок задач (один план, телефон+сервер вместе)
Сервер S1→S2→S3→S4→S5 (тестируемо, чинит баг), затем мобайл M1→M2 (шлёт header).
Commit-per-step + trailer. Push/deploy/флаг — только по слову Berik.

## Из охвата ИСКЛЮЧЕНО (отдельно, позже)
- Telegram location-кнопка / GPS geo-tz (`geo-tz`/`tz-lookup`) — не нужно для релиза
  телефона; Telegram пока на хранимом tz.
- Массовая унификация всех фолбэков по сервису — `DEFAULT_TZ` заводим, но переписывать
  каждый сервис не в этом срезе (все читают `user.timezone`, который теперь настоящий).
