# Решения ↔ Исходы (Decision↔Outcome) — Design Spec

**Дата:** 2026-06-04
**Автор:** Berik + Claude (brainstorming)
**Статус:** одобрено Berik (все 4 секции + авто-вердикт + win-rate)
**Скоуп:** SERVER-only (`packages/server`). Кросс-домен мост #4 из [[chief_of_staff_vision]]. Первый мост с настоящим write-циклом (журнал решений + ретро).

## Проблема / ценность

«Решил нанять — как вышло?», «3 мес назад выбрал поставщика A — окупилось?». На рынке ПУСТО. Никто не помнит за тебя твои решения и не возвращается спросить, сработали ли они. LifeOS как Chief of Staff: фиксирует решение + ожидание + дату проверки, проактивно возвращается на дату проверки, фиксирует фактический исход с вердиктом → со временем считает **win-rate** («8 из 12 сработали — 67%»), фундамент для рефлектор-инсайтов («чаще прав, когда не в спешке»).

## Решение (паттерн Obligations write-моста)

Переиспользуем образец Obligations 1:1: новая модель + write-инструменты (needsConfirm) + проактивный детектор по дате + enrichment-врезка + флаг-гейт. Новое = модель `Decision` + 2 инструмента + детектор + врезка + чистый `computeWinRate`.

## Секция 1 — Модель `Decision`

```prisma
model Decision {
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  title           String        // «решил нанять Айгуль», «выбрал поставщика A»
  expectedOutcome String?       // ожидание — свободный текст
  reviewDate      DateTime  @db.Date   // когда вернуться
  status          String    @default("open")  // 'open' | 'reviewed'
  actualOutcome   String?       // что вышло — текст (на ретро)
  verdict         String?       // 'worked' | 'didnt' | 'mixed' (на ретро)
  decidedAt       DateTime  @default(now())
  reviewedAt      DateTime?
  source          String    @default("manual")  // 'manual' | 'ai_suggested'
  @@index([userId, status, reviewDate])
}
```
+ relation `decisions Decision[]` в `User`. Миграция руками к ПРОД (`.env`=прод) + idempotent migration-папка (`CREATE TABLE IF NOT EXISTS` — как `cash_snapshot`) для тест-БД/Railway через `migrate deploy`. `onDelete: Cascade` (как Obligation). Связь с Entity (поставщик/человек) — НЕ в этом срезе (title-текст достаточно), добавим если понадобится.

## Секция 2 — Инструменты (write, needsConfirm)

`src/tools/log-decision.ts` + `src/tools/review-decision.ts`, паттерн 1:1 с `create-obligation.ts`/`settle-obligation.ts`:

- **`log_decision`** — `category:'planning'`, `needsConfirm:true`, `sideEffects:'write'`.
  Schema: `{ title: string(max240), expectedOutcome?: string(max500), reviewDate?: string }`.
  Handler: флаг-гейт `isV2DecisionsEnabled(ctx.userId)`; `reviewDate` парсится TZ-aware если задан, иначе **дефолт +90 дней** от локального сегодня; `prisma.decision.create({status:'open'})`. Ответ: подтверждение + «вернусь *дата* спросить, как вышло».
  aliases: `{ decision: 'title', что: 'title', ожидаю: 'expectedOutcome', expect: 'expectedOutcome' }`.

- **`review_decision`** — `category:'planning'`, `needsConfirm:true`, `sideEffects:'write'`.
  Schema: `{ title: string, actualOutcome: string(max500), verdict: 'worked'|'didnt'|'mixed' }`.
  Handler: флаг-гейт; fuzzy-матч `title` к ОТКРЫТЫМ решениям юзера (substring/ci, как settle-obligation матчит по description) — берём самое свежее совпадение; если нет — `{error:'не нашёл такое открытое решение'}`. Ставит `status:'reviewed'`, `reviewedAt:now`, `actualOutcome`, `verdict`.
  **Авто-вердикт:** `verdict` выводит АССИСТЕНТ из текста ретро и предлагает в реплике подтверждения («звучит как сработало — зафиксировать ✅?») — это поведение модели на confirm-шаге, схема просто принимает уже-определённый verdict. Инструмент сам verdict не угадывает (детерминизм).

Регистрация обоих в `tools/index.ts` `ALL_TOOLS` (флаг-гейт в хендлере, как Obligations).

## Секция 3 — Проактивный возврат + врезка + win-rate

- **Чистый хелпер** `src/services/decisions/types.ts`:
  - `parseVerdict(raw): Verdict | null` — нормализация ('worked'|'didnt'|'mixed', defensive).
  - `computeWinRate(reviewed: {verdict}[]): { reviewed: number; worked: number; rate: number | null }` — `rate = worked/reviewed` (null если 0); `mixed` НЕ считается worked.
  - `describeDecisionReview(d): string` — строка нуджа «N недель назад ты решил «X», ожидал «Y» — как вышло?».
- **Детектор** `detectDecisionReview(userId)` в `v2-proactivity-engine.ts` (1:1 `detectObligationDue`): ранний `if(!isV2DecisionsEnabled) return []` (динамический импорт); `prisma.decision.findMany({where:{userId,status:'open'},orderBy:{reviewDate:'asc'},take:20})`; кандидат если `reviewDate ≤ now`; significance по просрочке (дней). NudgeSource `'decision_review'` + scoreSignificance case + TEMPLATES блок (gentle/curious/supportive) + регистрация в `detectCandidates` Promise.allSettled + doc-count + exhaustiveness-тест.
- **Enrichment** `src/services/decisions/decisions.ts` `buildDecisionsContext(userId)`: открытые решения с `reviewDate ≤ now` (на проверку) + `computeWinRate` по reviewed. `formatDecisionsSection` (чистый рендер) в `v2-enrichment.ts` за `isV2DecisionsEnabled`, обёрнут per-builder `withTimeout(CROSS_DOMAIN_BUDGET_MS)`, поле `decisions` в `V2EnrichmentData`. Врезка: список «на проверку» + при ≥3 reviewed строка «решений проверено 12, сработало 8 — 67%».

## Секция 4 — Флаг, money-safety, тесты

- **Флаг** `isV2DecisionsEnabled` (env `FEATURE_V2_DECISIONS`, форма `all|true|none|false|user-X`, копия `isV2AxesEnabled`) + юнит-кейс. Off ⇒ байт-идентично (инструменты возвращают `{error:'функция отключена'}`, детектор/врезка возвращают пусто/null).
- **Money-safety:** `Decision` пишет ТОЛЬКО себя — ноль `prisma.income/expense.create` в decisions-коде и инструментах (структурный guard). Оба инструмента `needsConfirm:true`. Decisions read-path (`decisions.ts`, детектор) — READ-ONLY (guard).
- **GDPR:** `decision.deleteMany` в транзакции удаления аккаунта (`routes/auth.ts`) — `auth-delete-coverage` тест это стережёт.
- **Тесты:**
  - pure (`decisions/types.test.ts`): `computeWinRate` (норма; 0 reviewed→null; mixed не worked; все worked→1); `parseVerdict` (валид/мусор→null); `describeDecisionReview` непустая.
  - поведенческий it (`decisions/decisions.it.test.ts`, тест-БД): log_decision эквивалент (seed Decision open, reviewDate в прошлом) → `detectDecisionReview` даёт кандидата; reviewDate в будущем → пусто; `buildDecisionsContext` win-rate по reviewed; cross-user изоляция.
  - структурный: флаг существует+гейтит; `log_decision`/`review_decision` зарегистрированы; детектор+шаблон+регистрация+exhaustiveness; no-write guard (decisions.ts + детектор); enrichment-врезка подключена.
  - money-safety (`tools` test): оба needsConfirm:true, sideEffects:'write', пишут только `decision.create`/`update`.

Baseline: 2320 unit + 29 it зелёные; tsc чисто каждый таск.

## Rollout

Коммит на шаг (trailer `Co-Authored-By: Claude Opus 4.8 (1M context)`). После независимого code-reviewer ревью — push + deploy + флаг `FEATURE_V2_DECISIONS=all` (стандартное правило «всё включаем сразу для всех»). SMOKE: боту «реши: беру поставщика A, ожидаю −15% себестоимости, проверь через месяц» → подтверждение → (на дату проверки) проактивный нудж «как вышло?» → «сработало, себестоимость −12%» → бот предлагает verdict ✅ → win-rate растёт. Запрос «как мои решения?» → список + win-rate.

## Не в скоупе (YAGNI)

- Связь решения с Entity (поставщик/человек как сущность графа) — позже.
- Reflector-инсайты поверх win-rate («чаще прав когда не в спешке») — отдельный срез.
- Мобильный экран решений — при сборке приложения.
- Числовая шкала/дельта исхода — осознанно отвергнуто (ложная точность, трение).
