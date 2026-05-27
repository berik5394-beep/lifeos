# RELEASE — версионирование, теги, история

Этот файл — convention версий И changelog в одном месте. Не дублируем
в CHANGELOG.md / GitHub Releases / package.json release notes — только
здесь, чтобы было одно место.

## Где что лежит (для future-me / нового агента)

| Файл                          | Назначение                                     |
|-------------------------------|------------------------------------------------|
| `AGENTS.md`                   | Договор с агентом — правила работы (11 шт)     |
| `CLAUDE.md`                   | Product spec — что строим, как выглядит        |
| `docs/SMOKE.md`               | Пост-деплой checklist                          |
| `docs/RELEASE.md` (этот файл) | Convention версий + история релизов            |
| `docs/migration/PHASE*.md`    | История фаз разработки (Phase 5, 6, ...)       |
| `docs/migration/ISSUES.md`    | Открытые вопросы / решения / observations      |

Цепочка для нового агента: прочесть `AGENTS.md` (50 строк) → `RELEASE.md`
(этот файл, что сейчас в проде) → `SMOKE.md` (что проверять). Этого
достаточно для старта. `CLAUDE.md` — за деталями фичи когда понадобится.

---

## Convention версий

Формат: **`vMAJOR.MINOR.PATCH`** (semver).

- **MAJOR** — breaking change для юзера/API/контракта (billing, auth-
  overhaul, смена data-модели с миграцией данных)
- **MINOR** — новая фича, обратно-совместимая (новая phase, новый канал,
  web-cabinet, мульти-провайдер LLM)
- **PATCH** — bugfix / hotfix / performance, без новых пользовательских
  поверхностей

`package.json` `"version"` ведём синхронно с MAJOR.MINOR (PATCH в
`package.json` можно не двигать — это меняется реже).

## Когда ставить тег

1. Deploy в production выполнен.
2. `docs/SMOKE.md` пройден ПОЛНОСТЬЮ зелёным (все обязательные пункты).
3. Только после п.1 + п.2:

   ```bash
   git checkout main
   git pull origin main
   # убедиться что HEAD = именно тот commit, который сейчас в prod
   git tag -a vX.Y.Z <commit-sha> -m "vX.Y.Z — короткое описание"
   git push origin vX.Y.Z
   ```

Тег ставится на **тот же commit, который реально задеплоен и verified**
(не «на следующий» / «на main HEAD по факту»).

## Rollback

Если после deploy SMOKE красный и hotfix не решает за 15 минут:

```bash
git checkout vX.Y.Z   # последний GREEN тег
# в Railway: redeploy этого commit'а (UI → deployments → redeploy)
```

После rollback — записать инцидент в раздел «История» ниже с пометкой
«ROLLED BACK FROM vA.B.C → vX.Y.Z».

---

## История релизов

### v1.0.0 — 2026-05-22 — Phase 5+6 baseline + Aydana fix
**Commit**: `d9b46f9` (`fix(Aydana): kill agent-loop lie + pet inactivity ping spam`)
**Tag-type**: retroactive anchor — тег навешен задним числом на актуальный
prod-commit (источник истины: Railway API, deployment `02b672de`, status
SUCCESS, deployed 2026-05-22T15:54:23Z, healthcheck `/health` 120s).

> Примечание: предыдущий commit `3de47e8` (Phase 6 close-out) был
> запушен на main, но его deployment в Railway упал (status FAILED,
> builder=RAILPACK — вероятная причина). Реально живёт в проде
> `d9b46f9`, поэтому v1.0.0 anchor именно здесь.

**Что вошло (high-level)**:
- **Phase 5 — Reflector**: детерминированное ядро + Sonnet phrasing,
  R5/R4/R6/R8/P3.b закрыты
- **Phase 6 — Therapeutic Friend Layer**:
  - C1 Safety: two-tier gate (phrase Tier 1 + Haiku Tier 2 on emo),
    KZ-телефоны (150/111/1303)
  - C2 UserProfile (derived view-over-Memory)
  - C3 emotional + therapeutic mode + routing (Safety > therapeutic > toxic)
  - C4 5 therapeutic detectors (burnout/sleep/conflict/missed-date/intention-deviation)
  - C5 opt-out (`User.therapeuticMode` AND-gate)
- **P0 safety-recall hardening**: 9 non-explicit phrase patterns
  («устал существовать», «не вижу смысла продолжать» и др.)
- **P0 voice-safety fix**: `/voice/process` теперь через `handleMessage`
  (раньше bypass'ил crisis-gate)
- **Voice stack унифицирован**: 4 endpoint'а
  (`/voice/process`, `/voice/conversation/{message,text,end}`)
  через единый мозг `jarvis-orchestrator.handleMessage`
- **Aydana fix (commit `d9b46f9`)**: agent-loop больше не выдаёт
  «Действие НЕ выполнено», когда tool_use реально успешны. Если loop
  завершился `stop_reason=tool_use` без text-блоков — Claude
  до-вызывается без tools для финального итога. Без этого фикса бот
  отчитывался ложью при `maxToolRounds=3`-overflow на сложных задачах.
- **Pet inactivity ping отключён** (там же): питомец как механика
  живёт (insights / XP / streak), но push'ами «питомец скучает» не
  пинаем. По прямому требованию Berik'а 2026-05-22.
- **SSOT tool registry** — 23 tools (12 read + 8 write + 3 confirm:
  `addExpense`, `addIncome`, `sendTelegram`)
- 42 Prisma модели, ~15 hard-invariants (structural lint,
  refactor-proof source-parse tests), **773/773 тестов** проходят

**Breaking changes**: нет (первая tagged версия).

**Known limitations**:
- Mobile отстал от backend: `use-voice.ts` всё ещё на старом
  `/voice/process` контракте (запланировано на следующий deploy mobile build)
- Billing / IAP отсутствует полностью (pre-release, по дизайну)
- WhatsApp канал не реализован (TG-only через `@LifeOS_jarvis_bot`)
- Web-cabinet (Expo web export) не настроен
- Один live-тестер на момент тега (Aydana, tg584115772 — друг Berik'а)

**Migration notes**: нет (additive-only schema changes,
никаких user-actions не требуется).

**Verified в проде**:
- Railway deployment status: SUCCESS
- Health endpoint `/health` → HTTP 200 (`{"status":"ok"}`), проверено 2026-05-24
- Bot `@LifeOS_jarvis_bot` живой (behavioral verify Berik + Aydana)

---

### v1.0.1 — 2026-05-25 — Process discipline + Sentry SDK
**Commit**: `5e01d73`
**Tag-type**: regular (PATCH, после GREEN SMOKE)

**Что вошло (поверх v1.0.0)**:
- `AGENTS.md` (11 правил работы для AI-агента)
- `docs/SMOKE.md` (пост-деплой checklist с Aydana regression-guard)
- `docs/RELEASE.md` (semver convention + история тегов)

**Breaking changes**: нет (только docs + meta, runtime backend identical to v1.0.0).

**Known limitations**: те же что в v1.0.0.

**Migration notes**: нет.

**Verified в проде** (Berik 2026-05-25 15:47-15:48):
- `/health` 200, database in sync, Server listening
- Bot `@LifeOS_jarvis_bot` отвечает `/start`
- Aydana regression-guard: «запиши 3 задачи на завтра» → бот корректно
  записал и перечислил по именам
- Safety crisis: «не вижу смысла жить» → 112 + Союз кризисных центров КЗ
  + therapeutic tone

---

### v1.0.2 — 2026-05-25 — Friend-UX: hide audit footer (PATCH)
**Commit**: `222fc81`
**Tag-type**: regular (PATCH)

**Что вошло (поверх v1.0.1)**:
- Убран debug-маркер «— ✅ выполнено действий: N» из юзерских ответов
  (`routes/chat.ts`, `services/telegram-bot.ts`). Юзеру это выглядело
  как SQL-trace, не как ответ друга
- Gated за `DEBUG_AUDIT_FOOTER=true` env var (Berik включает локально
  когда отлаживает, юзеры не видят)

**Breaking changes**: нет (только UX-косметика).

**Verified в проде**:
- Railway deploy SUCCESS, health 200
- Behavioral: SKIPPED per user decision (Berik отказался от ручной
  проверки). Honest state per AGENTS.md §7.

---

### v1.0.3 — 2026-05-25 — P7 DND quiet hours (PATCH)
**Commit**: `0cccc53` (изначально tag был на `c5335ca`, retagged —
см. ⚠️ ниже)
**Tag-type**: regular (PATCH, additive default-off)

**Что вошло (поверх v1.0.2)**:
- `User.quietHoursStart/End String?` (nullable, "HH:MM" локально по
  `User.timezone`). null = DND off → нулевое user-visible изменение.
- `lib/tz.ts`: `localTimeStr()` + `isInQuietHours()` (поддержка
  cross-midnight интервалов типа 23:00→08:00, строгая HH:MM валидация
  regex `/^([01]\d|2[0-3]):[0-5]\d$/`)
- `push-service.ts`: DND guard в `deliverNotification()`. Если now ∈
  quiet hours → `{push:false, telegram:false, deferred:true}`,
  scheduler не помечает SentNotification → следующий tick retries
  → когда DND кончился, notification доставится автоматом
- 12 новых tests в `lib/tz.test.ts` + `phase7-schema.test.ts` invariant

⚠️ **Tag history note**: тег v1.0.3 первоначально был на commit
`c5335ca` (2026-05-25 19:44), но тот коммит содержал schema +
lib/tz.ts + tests **БЕЗ** `push-service.ts` (ошибка staging — файл
остался unstaged " M" вместо "M "). Фича была половинной: schema
в проде, guard — нет. Fix в `0cccc53`, тег перенесён.

**Breaking changes**: нет (additive default-off).

**Verified в проде**:
- Railway deploy `0cccc53` SUCCESS, health 200
- 795/795 тестов
- Behavioral: SKIPPED per user (как v1.0.2).

---

### v1.0.4 — 2026-05-26 — Tools quality: graceful Gmail + comment cleanup (PATCH)
**Commit**: `4060bef`
**Tag-type**: regular (PATCH)

**Что вошло (поверх v1.0.3)**:
- **get-email-triage graceful fallback**: handler ловит
  `GoogleCalendarError` и возвращает structured
  `{ connected:false, reason, message }` — бот объясняет юзеру
  по-человечески («Gmail не подключён, могу помочь подключить»)
  вместо silent throw. Friend-UX: класс багов hollow-tools.
  - `auth_failed` → not_connected
  - `token_refresh_failed` → token_expired
  - `api_error` / `not_configured` → api_error
  - unknown → unexpected_error (с console.warn для observability)
- **decompose-goal комментарий cleanup**: убран устаревший
  «ЗАГЛУШКА — логика на шаге 3» (handler реальный через
  `persistPlan` с Phase 5 P3.d, комментарий вводил в заблуждение)

**Систематический fix** для всех hollow-tools (tool-filter by
integration availability — Relayna pattern) — отдельная задача
(v1.1.x backlog).

**Breaking changes**: нет (additive).

**Verified в проде**:
- Railway deploy SUCCESS, health 200
- 137 tool tests passed, server tsc clean
- Behavioral: SKIPPED per Berik (как v1.0.2/v1.0.3 — honest state)

---

### v1.1.0 — 2026-05-26 — Tool-filter by integration availability (MINOR)
**Commit**: `37eed57`
**Tag-type**: regular (MINOR — новая backend capability)

> ⚠️ **Version reassignment**: ранее v1.1.0 был зарезервирован за
> «First Android APK release» (DRAFT). Mobile APK сдвинут на v1.2.0
> (ещё не shipped — install + smoke pending). MINOR-номер занят
> сегодня раньше, чем mobile удалось довести до раздачи.

**Что вошло (поверх v1.0.4)**:
- **Tool-filter pattern (Relayna)** — закрывает класс hollow-tools
  системно. Tool с `requires` integration не показывается агенту
  если у юзера integration не подключена → агент не вызовет →
  не упадёт → friend-UX чистый.
- `_types.ts`: новый тип `IntegrationRequirement`
  (`{ kind: 'google_oauth' | 'telegram_user_chat' }`), новое
  опциональное поле `Tool.requires`
- `tools/index.ts`: async функции `agentToolSchemasForUser(userId)`
  + `agentToolNamesForUser(userId)` фильтруют по integrations
  - Backward-compat: старые `agentToolSchemas`/`agentToolNames`
    оставлены для tests + legacy паттернов
  - `google_oauth` требует не просто active, но и refreshToken !== null
- `get-email-triage`: marked `requires: { kind: 'google_oauth' }`.
  Graceful try/catch остаётся как defense-in-depth (race с
  deactivation integration).
- `claude-agent.ts`: использует await user-aware версии в hot-path
- 14 новых invariant tests (`phase7-tool-filter.test.ts`) — без БД,
  парсят исходники

**Breaking changes**: нет (additive — старые функции оставлены).

**Verified в проде**:
- Railway deploy SUCCESS, health 200
- 809/809 тестов (795 → 809: +14)
- Behavioral: SKIPPED per Berik (как v1.0.2-v1.0.4 — honest state)

---

### v1.1.1 — 2026-05-26 — D: TZ-aware proactive notifications (PATCH)
**Commit**: `4f93a2e`
**Tag-type**: regular (PATCH — bug-fix класс)

**Bug-class** (найден в C2 audit): 5 notification types использовали
server local time (`new Date().setHours(H)`) вместо `User.timezone`.
Для Asia/Almaty юзера (UTC+5):
- evening_summary 21:00 → **02:00 ночи** (будило юзера)
- weekly_summary вс 20:00 → **01:00 понедельника**
- budget_alert 10:00 → 15:00 локально
- habit_nudge 14:00 → 19:00 локально
- inactivity_ping 12:00 → 17:00 локально (disabled per Aydana fix,
  но patched для consistency)

**Fix**:
- `lib/tz.ts`: новый `localDaySlot(hour, tz, at?)` — UTC-инстант
  полночь+H в tz юзера
- `daySlot(hour, tz)` — tz обязателен (старая server-local
  сигнатура удалена). Симметрия с `timeToDate("HH:MM", tz)`.
- `generateProactiveNotifications(userId)` fetches `User.timezone`
  один раз, передаёт в каждый generator (меньше DB queries)
- 5 generators получили `tz: string` parameter
- Tests: проверка через UTC-инстант (`.getTime()`), не `getHours()`
  (server-local — нестабилен). Cross-tz invariant:
  `daySlot(14,'Asia/Almaty')` vs `daySlot(14,'UTC')` = ровно 5h
- Morning briefing был tz-aware ранее (`timeToDate`) — не trogат

**Note**: gating проверки в generators (`if currentHour < 14`) тоже
страдают от server-local — это **отдельный** bug-class (не scheduling),
отложен в backlog.

**Merge conflict resolution**: cherry-pick встретил конфликт с Aydana
fix `d9b46f9` (отключение inactivityPing — спам «Питомец скучает»).
Manual merge сохранил Aydana disable + применил tz fix к остальным
4 generators. inactivityPing функция в коде остаётся для тестов/
истории, но не вызывается из main dispatcher.

**Breaking changes**: нет (PATCH bug-fix).

**Verified в проде**:
- Railway deploy SUCCESS, health 200
- 811/811 тестов (809 → 811: +2 tz cross-zone coverage)
- Behavioral: SKIPPED per Berik (как v1.0.2-v1.1.0)

---

### v1.1.2 — 2026-05-26 — C3: friend-tone notifications (MINOR)
**Commit**: `9dd7540`
**Tag-type**: regular (MINOR — пользователь увидит ощутимое
изменение в push'ах, хотя backward-compatible)

**Что вошло**: 5 user-facing notification текстов переписаны под
«звучит как друг» (audit показал средний friend-score 5.2/10 →
~8/10 после правок). Имя юзера + конкретная похвала + actionable
вопросы вместо шаблонной мотивации.

- **morning_briefing**: title точка вместо «!», CTA «Начнём?» вместо
  «Открой LifeOS — спланируем день»
- **habit_nudge**: title «Привычки» (не «Не забудь»), имя +
  конкретный стрик впереди, «Не дай стрику упасть» / «Закроем сегодня?»
- **budget_alert**: без обвинения «ты потратил», с math (₸/день) +
  actionable «Что закажем урезать?». 95%+ → «уже тонко»
- **evening_summary**: имя + closed-числа в текст (не отдельно X/Y%)
- **weekly_summary**: имя + цифры в текст, концовка вопросом

**Архитектура**: `generateProactiveNotifications` fetches +name
(было только timezone), 4 generators получили `name: string` param.
inactivityPing tz-patched но disabled (Aydana fix сохранён через
manual merge conflict).

**Breaking changes**: нет (тексты — backward-compat).

**Verified в проде**: Railway deploy SUCCESS, health 200,
811/811 tests, behavioral SKIP per Berik.

---

### v1.1.3 — 2026-05-26 — C4: tool descriptions precision (PATCH)
**Commit**: `cb1b5e8`
**Tag-type**: regular (PATCH — description-only, агент видит чище,
runtime поведение не меняется)

**Что вошло**: 5 tool descriptions расширены для устранения
ambiguities и misfire'ов (audit показал что 5 из 23 tools имели
минимальные/ambiguous descriptions):

- **complete-habit**: + disambig от complete_multiple_habits +
  trigger phrases
- **complete-task**: + trigger phrases «закрой задачу X», «X готово»
- **journal-entry**: + trigger phrases + disambig от create_task
  («субъективное состояние, не дело»)
- **create-task**: + disambig от decompose_goal («для разбивки
  БОЛЬШОЙ цели — используй decompose_goal, не create_task в цикле»)
- **get-calendar**: + cross-reference get_free_slots («для поиска
  СВОБОДНЫХ окон — get_free_slots, не считай в уме»)

**Breaking changes**: нет (description-only, handler logic не trogат).

**Verified в проде**: Railway deploy SUCCESS, health 200, 811/811 tests,
behavioral SKIP per Berik.

---

### v1.1.4 — 2026-05-26 — E: tz-aware gating + getToday + isSunday (PATCH)
**Commit**: `71e6244`
**Tag-type**: regular (PATCH — продолжение D bug-class)

**Bug-class**: D (v1.1.1) пофиксил scheduling (когда notification
приходит). E фиксит gating (нужно ли вообще генерить) и getToday
(какой day для DB queries). 4 server-local checks → локальные:
- `getToday()` использовал `setHours(0)` сервера → DB query
  task/habit/event на «сегодня» возвращал not-юзерский день
  (Almaty юзер ~00:00 локально, server думает «завтра»)
- `isSunday()` → server day, Almaty юзер в воскресенье 00:00-05:00
  локально weekly_summary НЕ trigger'илась (server думал суббота)
- `generateHabitNudges currentHour 14-20` → Almaty юзеру gate
  работал в 19:00-01:00 локально (за пределами afternoon)
- `generateWeeklySummary now.getHours() === 20` → server-local
- `generateInactivityPing currentHour 12-15` → disabled (Aydana fix),
  patched для consistency

**Fix**:
- `lib/tz.ts`: `localDayOfWeek(tz)` — 0-6 через Intl.DateTimeFormat
- `getToday()` → `getToday(tz: string)` — UTC instant полночи в tz
- `isSunday()` → `isSundayLocal(tz: string)`
- 6 callers getToday updated → передают tz
- gating: `now.getHours()` / `currentHour` → `localHour(tz, now)`
- `generateEventReminders` reordered: fetch tz first, потом today
- `buildMorning` signature: + `tz: string` (передаётся из generator)

**Scope**: D + E полностью закрывают tz-bug class для proactive
notifications. Morning/event_reminders уже были tz-correct (W11 fix).

**Breaking changes**: нет (internal refactor, signatures internal).

**Verified в проде**: Railway deploy SUCCESS, health 200, 811/811 tests,
behavioral SKIP per Berik.

---

### v1.2.0 — 2026-05-26 — Travelpayouts search_flights (MINOR)
**Commit**: `de91ab8`
**Tag-type**: regular (MINOR — новая capability «найди билеты»)

> ⚠️ **Version reassignment**: ранее v1.2.0 был зарезервирован за
> «First Android APK release» (DRAFT). Mobile APK сдвинут на v1.3.0
> (install + smoke pending). Pattern same as v1.1.0 reassignment.

**Что вошло (поверх v1.1.4)**:
- **search_flights tool** — active flight search через Aviasales
  prices_for_dates v3. Раньше `get_trip` показывал только existing
  TravelPlan (passive); теперь юзер может «найди билет в Алматы на
  15 июля» и agent делает реальный API call.
- **integrations/travelpayouts.ts** (новый folder!) — thin HTTP client:
  - searchFlights({origin, destination, departureAt, returnAt?, currency?})
  - TravelpayoutsError(code: 'not_configured'|'api_error'|'invalid_input')
  - Auth X-Access-Token (server-level, не user OAuth)
  - Affiliate marker автоматом → revenue share
  - Timeout 8s через AbortController
- **tools/search-flights.ts** — graceful fallback (AGENTS.md §12)
  pattern: 4 ветки catch → structured response вместо throw
- **Zod schema**: IATA validation (length 3) + YYYY-MM-DD regex
- **9 новых tests** (search-flights.test.ts) — graceful path,
  zod validation, registry consistency
- **Disambiguation** в description: НЕ путать с get_trip

**ENV**:
- packages/server/.env уже содержит TRAVELPAYOUTS_TOKEN/MARKER
- Railway prod env vars **НЕ добавлены** → graceful fallback сработает
  («Поиск билетов сейчас не подключён»). Когда Berik добавит — tool
  заработает БЕЗ нового deploy

**Breaking changes**: нет (новый tool, не trogат existing).

**Verified в проде**: Railway deploy SUCCESS, health 200, 823/823
tests, behavioral SKIP per Berik.

---

### v1.2.2 — 2026-05-27 — L99 audit HIGH fixes (PATCH)
**Commit**: `5c823dd`
**Tag-type**: regular (PATCH — 5 mechanical fixes, low risk)

**Context**: 3 sequential agents (general-purpose → superpowers/code-reviewer
→ general-purpose) провели L99 audit tool dispatch chain. 22+ findings
(0 Critical, 3 High, 9 Medium, 9 Low). HIGH fixes shipped в этом PATCH.

**Что вошло (поверх v1.2.1)**:

- **#9 [DATA LOSS] create-event.ts** — STRICT title equality + startTime match.
  Раньше `title.slice(0,40) contains` молча перезаписывал разные события с
  общим префиксом («Встреча с Сериком — поставщик» затирала «Встреча с
  Сериком — клиент»). Audit trail: UPDATE логируется через console.warn.
- **#2 [PHASE-7 INVARIANT] tools/index.ts:160** — `refreshToken !== null`
  пропускал пустые строки (после Google revoke flow). Tool оставался в
  списке → API падал `auth_failed`. Fix: `refreshToken != null &&
  refreshToken.trim().length > 0`. Test phase7-tool-filter обновлён.
- **#6 [HIDDEN DATA] get-trip.ts horizon** — раньше `dateFrom >= horizon`
  скрывал active trips (началась 5 дней назад, in_progress). Friend не
  знал что юзер в Дубае. Fix: `OR: [upcoming, currently-active]`.
- **#20 [INVARIANT] runRegistryTool schema.parse** — ZodError throw'ся ДО
  `auditToolCall` → ToolCall row не писался → badges/honesty tests слепы
  к validation failures. Fix: parse внутри audit closure. Тест обновлён.
- **#14+#4 [REGISTRY GUARDS]**:
  - Load-time dup-name guard в `tools/index.ts` (IIFE assert). Два tools
    с одним именем больше не silent last-wins — server вообще не стартует.
  - Recursive $ref scan в registry-consistency.test. `zodToJsonSchema`
    настроен `$refStrategy:'none'`, но никто не проверял что в реальных
    схемах нет refs. Future z.lazy()/recursive структура → тест упадёт.

**L99 findings остаток** → v1.3.0 R9 backlog:
- TZ coherence pass (#5+#7+#8+#15+#17): единый getUserTimezone helper для
  money/habit/event/journal tools. Critical: #15 — money TZ-bug в add-expense/
  add-income (выше stakes чем habits — Almaty юзер в 00:30 локально → запись
  в not-юзерский день/месяц).
- Honesty (#1 Aydana stub, #25 structured tool_result, #16 N+1).
- Low: #3 search_flights env_secret kind, #11 send_telegram pre-check,
  #13 .describe() coverage, #18 complete-task date scope, etc.

**Breaking changes**: нет (mechanical fixes, не trogат public API).

**Verified в проде**: Railway deploy SUCCESS (<30 сек), health 200,
**825/825 tests** (+2 new invariants), tsc clean.
Behavioral SKIP per Berik.

---

### v1.3.0 — 2026-05-27 — R9 TZ coherence pass (MINOR)
**Commit**: `ab6e1b6`
**Tag-type**: regular (MINOR — semantics для всех users меняется,
backward-compat но meaningful behaviour change)

> ⚠️ **Version reassignment**: v1.3.0 был зарезервирован за «First
> Android APK release» (DRAFT). Mobile APK сдвинут на v1.4.0 (install
> + smoke pending). Pattern: ship-when-ready беречь semver вес.

**Context**: L99 audit нашёл tz-bug class в 8 tools — write side
писал `today` через `setHours(0,0,0,0)` = server-local UTC midnight;
read side query'ил с теми же server bounds. Для Almaty юзера
(UTC+5) в 00:30 локально (= 19:30 UTC prev day) expense/income/
habit/journal попадали в **предыдущий день** server-time → wrong
month aggregation для get-budget. Money stakes > habit stakes —
#15 был High priority в audit.

**8 tools migrated на localDayStartUTC(tz)**:

WRITE side:
- `add-expense.ts` (#15 money — высокий impact)
- `add-income.ts` (#15)
- `complete-habit.ts` (#8)
- `complete-multiple-habits.ts` (#8)
- `journal-entry.ts` (#8)

READ side (handler + Zod regex YYYY-MM-DD):
- `get-tasks.ts` (#5 schema + #8 handler today)
- `get-calendar.ts` (#5 schema + handler date range)
- `get-budget.ts` (#7 — раньше известный debt coupled с write-side;
  теперь когда write-side fixed, coherence закрыта)

**Pattern**: handler fetches `user.timezone`, использует helpers из
`lib/tz.ts`:
- `localDayStartUTC(tz)` — UTC instant начала локального дня
- `localDayStartUTC(tz, midDayUTC)` — для конкретной даты (mid-day
  UTC trick для надёжного попадания в нужный локальный день)
- `localDateStr(tz)` — "YYYY-MM-DD" в локальной tz юзера

**НЕ trogаны намеренно**:
- `create-event` — `new Date('YYYY-MM-DD')` пишет UTC midnight,
  read tools tz-aware querят range которая включает этот instant
  для всех адекватных tz (Almaty 27.05 UTC midnight = 05:00 локально
  → в range «начало локального 27.05»). Consistent.
- `get-trip` horizon — patched в v1.2.2 (L99 #6).

**L99 R9 backlog** (honesty fixes, отдельный batch):
- #1 Aydana stub redesign (Claude lie при filtered tool)
- #25 structured tool_result {ok:false} вместо текста
- #16 N+1 + silent skip в complete-multiple-habits

**Breaking changes**: нет (semantics MORE correct, не trogат API).

**Verified в проде**: Railway SUCCESS, health 200, **825/825 tests**.
Behavioral SKIP per Berik.

---

### v1.3.1 — 2026-05-27 — R9 honesty layer (PATCH)
**Commit**: `d904a46`
**Tag-type**: regular (PATCH — same semantics, более правильная honesty layer)

**Что вошло (L99 #25 + #16, поверх v1.3.0)**:

- **STEP A — DRY (new helper)**: `packages/server/src/lib/user-context.ts`
  с `getUserTimezone(userId)`. 8 tools мигрированы с inline
  `prisma.user.findUnique({select:{timezone:true}}) + user?.timezone || 'UTC'`
  pattern на helper (add-expense, add-income, complete-habit,
  complete-multiple-habits, journal-entry, get-tasks, get-calendar,
  get-budget). Graceful fallback к UTC если prisma throws.
- **STEP B — N+1 fix (#16)**: `complete-multiple-habits` —
  раньше sequential `await` loops (N roundtrips к Prisma на N имён
  + N последовательных upserts). Теперь `Promise.all` на name resolve
  + `Promise.allSettled` на upserts с per-habit статусом. Return shape
  расширен: `succeededIds`, `failedIds`, `notFoundNames` — агент видит
  правду по каждой привычке вместо «Отмечено: N» без понимания которые
  именно failed.
- **STEP C+D — structured tool_result (#25)**: `claude-agent.ts`
  tool_use loop catch — раньше при failure возвращали русский prose
  `"Ошибка инструмента X: ..."` как `tool_result.content`. Claude мог
  interpret prose как success result и врать «записал»/«готово».
  Теперь явное `JSON.stringify({ok:false, error, tool})` +
  Anthropic-native `is_error:true` на tool_result. Модель знает
  definitively что failure и не фабрикует success-ответ.

**Breaking changes**: нет (тот же контракт, более правильное
тело tool_result на failure-пути).

**Verified в проде**: Railway SUCCESS, health 200, **825/825 tests**.
Behavioral SKIP per Berik.

---

### v1.3.2 — 2026-05-27 — R9 TZ write-side closure (PATCH)
**Commit**: `1e13e7d`
**Tag-type**: regular (PATCH — read/write symmetry fix)

**Что вошло (L99 #17 + #8 закрытие, поверх v1.3.1)**:

- **create-event tz-aware**: было `new Date(input.date)` → UTC
  midnight, теперь `localDayStartUTC(tz, mid-day UTC)` — symmetric
  с get-calendar (read tz-aware с v1.3.0). Для Almaty юзера (UTC+5)
  раньше встреча «28 мая» сохранялась как 2026-05-28T00:00:00Z,
  но `get-calendar` искал как 2026-05-27T19:00:00Z (начало 28-го
  локально) — встреча **исчезала из view**.
- **create-task tz-aware**: тот же fix — symmetric с get-tasks.
- **Anti-dup окно ±3 дня** в create-event теперь shift'ится от
  tz-anchored date (preserves локальный day boundary).

**Closing**: остаток L99 #17 (events write) + #8 (tasks write
coherence). R9 TZ pass теперь **полностью симметричен** на 10 tools
(8 в v1.3.0 + 2 в v1.3.2).

**Breaking changes**: нет (date column в Prisma — `@db.Date`,
fractional time усекается; новая семантика просто кладёт тот же
локальный день в правильный UTC instant).

**Verified в проде**: Railway SUCCESS, health 200, **825/825 tests**.
Behavioral SKIP per Berik.

---

### v1.3.3 — 2026-05-27 — Aydana stub redesign (PATCH)
**Commit**: `cc27116`
**Tag-type**: regular (PATCH — root cause Aydana fix)

**Что вошло (L99 #1 закрытие, поверх v1.3.2)**:

- **claude-agent.ts Aydana stub** (изначально v1.0.0 fix `d9b46f9`)
  **redesigned**: раньше при `maxToolRounds`-overflow pushили fake
  `tool_result.content = "Лимит шагов: подведи итог тем, что уже
  сделал."` для каждого pending tool_use. Эти tools физически НЕ
  выполнены — только requested. Claude интерпретировал stub как
  success → галлюцинировал «записал N задач» для невыполненных
  tools (главный Aydana-баг был именно тут: пользователь видел
  подтверждение записи, которой нет в БД).
- **Fix (option 1, по выбору Berik)**: РЕАЛЬНО выполняем pending
  tools через тот же `runRegistryTool` dispatch — единый audit
  trail + structured failure через `is_error:true` (symmetric с
  STEP C из v1.3.1). Стоимость та же (+1 раунд Claude всё равно
  был). Claude теперь видит честные results и суммирует правду.
- Filter по `localNames` (как в основном loop) — web_search не трогаем.

**R9 honesty layer теперь полностью закрыт**: #25 (structured
tool_result), #16 (N+1 complete-multiple-habits), #1 (Aydana stub).

**Breaking changes**: нет (расходов больше не делает — те же tool
calls, что Claude и так бы сделал на +1 раунде).

**Verified в проде**: Railway SUCCESS, health 200, **825/825 tests**.
Behavioral SKIP per Berik.

---

### v1.4.0 — TBD — First Android APK release [DRAFT]
**Commit**: TBD (после cherry-pick worktree → main)
**Tag-type**: regular (MINOR, после GREEN install smoke на устройстве)

> ⚠️ **DRAFT** — заполнено заранее, последний блок «Verified в проде»
> подтверждается после STAGE 4 smoke в `docs/plan/mobile-build.md`.

**Что вошло (поверх v1.0.1)**:

- **First Android APK** через EAS Build (preview channel, internal
  distribution). Build #2 (`63a073be`) FINISHED, APK:
  https://expo.dev/artifacts/eas/dix4JDnZMJjVNiV83DD6b5.apk
- **EAS Update (OTA)** настроен — channel `preview`, runtimeVersion
  `{policy: appVersion}`. Bugfix workflow: `eas update` 30 сек,
  юзер открывает app → автоматически новый JS bundle.
- **Sentry crash reporting** integrated в mobile (`@sentry/react-native ~7.2.0`):
  - `crash-reporting.ts` свапнут с console-placeholder на реальный
    Sentry (dev=console, prod=Sentry, graceful fallback если DSN нет)
  - `App.tsx` обёрнут `Sentry.wrap(App)`, `crashReporting.init()` в
    module scope
  - `ErrorBoundary` в `navigation/index.tsx` ловит React-errors →
    `componentDidCatch` → Sentry
  - **Source maps DISABLED** (нет AUTH_TOKEN). Stack traces будут
    minified до v1.1.1 (см. task #15).
- **ARCHITECTURE.md полная переписана** (335→482 строк) под Phase 5/6 +
  SSOT registry + Aydana fix. Карта документов, 8 архитектурных
  принципов, актуальные counts (42 routes, 38 services, 23 tools,
  42 Prisma models).
- **5 устаревших audit-снимков удалены** (все P0 закрыто, см. git
  history): `AUDIT-{ARCHITECTURE,CODE-REVIEW,FRONTEND,SECURITY,SUMMARY}.md`.
- **plan/ convention** (AGENTS.md §1) применён впервые:
  - `docs/plan/mobile-build.md` (текущая работа)
  - `docs/plan/travelpayouts-integration.md` (backlog v1.2.0)
  - `docs/plan/2gis-integration.md` (deadline 2026-06-25)
  - `docs/plan/openweather-integration.md` (backlog v1.2.0/v1.3.0)
  - `docs/plan/newsapi-integration.md` (use case decision BLOCKING)
- **5 integration ключей** записаны в `packages/server/.env` (gitignored)
  для будущих v1.2.0+ интеграций: Travelpayouts (2 var), 2GIS,
  OpenWeather, NewsAPI. Gemini намеренно НЕ записан (Berik отказался).

**Breaking changes**: нет (backend identical to v1.0.1, новое только
mobile platform).

**Known limitations**:
- **iOS NOT built** — требует Apple Developer Account ($99/год)
- **Sentry source maps disabled** — стек-трейсы minified
  (фикс в v1.1.1: см. task #15)
- **Legacy `use-voice.ts`** всё ещё на `/voice/process` — 6 экранов.
  Migration в `/voice/conversation/*` отложена (v1.2.0 / v1.3.0).
- **Billing/IAP отсутствует** — pre-release, по дизайну.
- **WhatsApp канал не реализован** (TG-only через `@LifeOS_jarvis_bot`).
- **5 интеграций не active** (Travelpayouts/2GIS/OpenWeather/NewsAPI) —
  только plan/ файлы + ключи в `.env`, реализация в v1.2.0+.

**Migration notes**:
- Юзеры скачивают APK через ссылку (не Play Store ещё)
- Раздача через Telegram link, Android «небезопасный источник» warning
  стандартен (Settings → разрешить установку)
- OTA-обновления автоматом при следующем open app (если JS-only fix)

**Verified в проде** (TBD): ожидается после STAGE 4 install smoke (`docs/plan/mobile-build.md`).

---

### Шаблон для следующих записей

```
### vX.Y.Z — YYYY-MM-DD — короткое имя
**Commit**: <sha>
**Tag-type**: regular (после GREEN smoke) | retroactive | hotfix

**Что вошло**:
- bullet 1
- bullet 2

**Breaking changes**: ... (или «нет»)

**Known limitations**: ... (или «нет»)

**Migration notes**: ... (что нужно сделать руками — env vars,
   db migration, rebuild mobile, и т.п.)

**Verified в проде**: SMOKE.md GREEN, дата, кем
```
