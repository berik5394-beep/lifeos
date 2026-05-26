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

### v1.2.0 — TBD — First Android APK release [DRAFT]
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
