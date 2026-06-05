# Памятные даты (день памяти) — Дизайн-спека

> Клин «Память отношений», под-срез (б+). Прямое расширение фичи ДР (deployed).
> Закрывает пустое обещание: Berik попросил «напоминай 10 августа» (death_date
> папы), бот пообещал, но НИКТО не читал death_date. Berik одобрил дизайн 2026-06-05.

## Цель (одно предложение)
Бот проактивно и БЕРЕЖНО напоминает о днях памяти близких — «Завтра годовщина —
память папы. Если нужно, я рядом» — за день и в сам день.

## Границы (scope)
- SERVER-only (`packages/server`). Флаг-гейт — переиспользуем `isV2BirthdayEnabled`
  (та же фича «ключевые даты», уже `=all` в проде). При OFF — байт-идентично.
- READ-ONLY: ноль записей, ноль денег. Данные `death_date` уже пишет фоновый
  capture-extractor (`v2-capture` → extractEntities). **Write-инструмент НЕ делаем** (YAGNI).
- Окно: день памяти + за 1 день (зеркало окна ДР). Enrichment-окно 7 дней.
- Тон: ВСЕГДА supportive/gentle. Токсичный/строгий стиль ассистента на мемориале
  принудительно смягчается (safety > style). Никаких «поздравишь?»/celebratory.
- НЕ в этом срезе: нормализация хранения (capture пишет строкой, set_birthday —
  структурой; `parseBirthday` читает обе → функционально ок, откладываем).

## Хранение
- `Entity.attributes.death_date` — строка в существующем `attributes Json`
  (напр. «10 августа 2021»). Без миграции. Только `Entity.type === 'person'`.
- `parseBirthday` (services/birthday/types.ts) УЖЕ парсит «10 августа 2021» →
  `{day:10, month:8, year:2021}` (regex рус-месяц + опц. год). Реюз без изменений.

## Компоненты

### 1. Чистый хелпер — `src/services/birthday/types.ts` (добавить)
- `formatMemorialSection(rows: UpcomingBirthday[]): string | null`
  - Пусто → null. Иначе: `День памяти: {name} — {whenLabel(daysUntil)}; ...`.
  - Реюз существующего `whenLabel`. Тип строки тот же `UpcomingBirthday`
    (entityId/name/importance/daysUntil/age) — для мемориала `age` игнорируем
    в выводе (возраст не показываем).

### 2. Read-only гейтер — `src/services/birthday/birthday.ts` (добавить)
- `listMemorials(userId): Promise<PersonBirthdayRow[]>` — `prisma.entity.findMany`
  where type='person'; для каждого `parseBirthday(attrs.death_date)`; валидные →
  row { entityId, name, importance, birthday: parsed }. (поле `birthday` тут несёт
  дату памяти — переиспользуем тип, чтобы не плодить структуры.)
- `buildUpcomingMemorials(userId, now, windowDays): Promise<UpcomingBirthday[]>` —
  `listMemorials` → `upcomingBirthdays(rows, now, windowDays)` (реюз сортировки/фильтра).
- `buildMemorialSection(userId): Promise<string | null>` —
  `formatMemorialSection(await buildUpcomingMemorials(userId, new Date(), 7))`.
- Money-safety: только `entity.findMany` (read). Структурный тест: ноль write в файле.

### 3. Проактивный детектор — `src/services/v2-proactivity-engine.ts`
- `NudgeSource`: добавить `'memorial_upcoming'`.
- `TEMPLATES.memorial_upcoming` — ТОЛЬКО тёплые тона (supportive/gentle), без celebratory:
  - `gentle`: `'{{whenLabel}} годовщина — память {{name}}. Если нужно, я рядом.'`
  - `supportive`: `'{{whenLabel}} день памяти {{name}}. Береги себя сегодня.'`
- `scoreSignificance`: case `'memorial_upcoming'` → стабильно `0.7` (≥ floor gate3 0.6,
  чтобы доходило; как obligation_due/decision_review).
- `async function detectMemorial(userId)`:
  - РАННИЙ `if(!isV2BirthdayEnabled(userId)) return []` (тот же флаг, off=identical).
  - `buildUpcomingMemorials(userId, new Date(), 1)` → для каждого NudgeCandidate
    `{ source:'memorial_upcoming', entityId, payload:{ name, daysUntil, whenLabel:whenLabel(daysUntil) }, toneHint:'supportive' }`; significance = scoreSignificance.
  - try/catch → `[]` (паттерн прочих детекторов).
- Регистрация в `detectCandidates` Promise.allSettled([... detectMemorial(userId)]).
- Exhaustiveness-тест union обновить.

### 4. Tone-safety (критично) — ГАРАНТ через детерминированный шаблон
Проверено по коду (`generateNudge` ~919): стиль-rewrite ОТСУТСТВУЕТ. Если есть
`TEMPLATES[source][toneHint]` → возвращается фиксированный interpolate-текст (строка
943-945), стиль ассистента (вкл. токсичный) НЕ применяется. Claude-haiku — лишь
fallback, когда шаблона НЕТ.
Следствие — tone-safety обеспечивается ДВУМЯ условиями (оба обязательны):
1. Детектор ставит `toneHint: 'supportive'`.
2. `TEMPLATES.memorial_upcoming` ОБЯЗАТЕЛЬНО содержит ключ `supportive` (и `gentle`)
   — тогда generateNudge всегда вернёт тёплый шаблон, haiku-fallback не сработает,
   токсичный стиль недостижим.
Никакого отдельного guard в generateNudge НЕ нужно (стиль-rewrite не существует).
Структурный тест закрепляет: TEMPLATES.memorial_upcoming.supportive существует,
текст без «поздравишь»/celebratory, содержит «память»/«рядом».

### 5. Enrichment-врезка — `src/services/v2-enrichment.ts`
- Поле `memorials: string | null` в `V2EnrichmentData` (рядом с `birthdays`).
- Gather: `isV2BirthdayEnabled(userId) ? withTimeout(buildMemorialSection(userId), CROSS_DOMAIN_BUDGET_MS, null).catch(()=>null) : Promise.resolve(null)` — добавить в Promise.all (последним, синхронно с деструктуризацией) + в объект data.
- `buildV2EnrichmentBlock`: `if (data.memorials) lines.push(data.memorials)`.

## Тесты
- **Pure-юнит** (`birthday/types.test.ts`, добавить): `formatMemorialSection` —
  пусто→null; «День памяти: папа — завтра; …». (parseBirthday «10 августа 2021»
  уже покрыт.)
- **Поведенческий** (`birthday.it.test.ts`, добавить): entity person с
  `attributes.death_date='10 августа 2021'` → `buildUpcomingMemorials(now=за день, 1)`
  находит; дальний (>7д) вне окна 7; cross-user изоляция; флаг OFF (FEATURE_V2_BIRTHDAY
  unset) → detectMemorial=[].
- **Структурный** (`memorial-wiring.test.ts` или в birthday-wiring): `memorial_upcoming`
  в NudgeSource+TEMPLATES+scoreSignificance+detectCandidates; detectMemorial ранний
  флаг-гейт; enrichment-врезка (memorials поле + buildMemorialSection + if(data.memorials));
  **tone-guard**: TEMPLATES.memorial_upcoming НЕ содержит «поздравишь»/«celebratory»,
  содержит «память»/«рядом»; generateNudge содержит guard на memorial (skip style-rewrite);
  money-safety: ноль prisma write в birthday.ts (уже есть гард — расширить охват).
- Baseline вся сюита зелёная (~2477 unit); `tsc` чисто каждый таск; zero vi.mock.

## Money-safety
Фича не пишет ничего (ни деньги, ни память). Чтение `Entity.attributes.death_date`.

## Rollout
- Коммит на шаг (trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`).
- push/deploy/флаг — по слову Berik (флаг уже `=all`, отдельной env-правки НЕ нужно).
- SMOKE: у Берика `death_date` папы «10 августа 2021» уже в БД → на тике проактивности
  ближе к 9–10 августа придёт «Завтра годовщина — память папы. Если нужно, я рядом».
  Проверка раньше срока: временно сдвинуть окно/дату в тест-юзере или дождаться 9 авг.

## Открытые мелочи (решены явно)
- Окно детектора = 1 день (день + накануне). Enrichment-окно = 7 дней.
- Возраст на мемориале НЕ показываем.
- Один флаг (isV2BirthdayEnabled) на обе под-фичи «ключевые даты».
- death_date пишет capture-extractor; собственного write-инструмента нет (v1).
