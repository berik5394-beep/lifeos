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
