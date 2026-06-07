# Entity Coreference (resolve-then-merge) — дизайн

> Фикс **T1** из диагностики памяти (`docs/diagnostics/2026-06-07-memory-quality-diagnosis.md`). Приоритет №1 «Память-качество». SERVER-only (`packages/server`). Полный цикл, НЕ кодить до одобрения спеки Berik.

## Цель
Перестать дробить одну реальную сущность на дубли по падежам/вариантам имени («Серик / Серика / Сериком / Серик Жумабаев» = сейчас 4 строки). Это **корень** ненадёжности графа — все per-entity сигналы (частоты, настроение, «давно не звонил», relationship-link, person-types, neglected-key-person) читают по `entityId` и сейчас расщепляются.

## Корневая причина (доказано чтением)
- `resolveEntity` (`postgres-impl.ts:142`) — трёхступенчатый резолвер (FTS-имя со стеммингом → FTS-алиасы → эмбеддинг-косинус) — **построен, но НИГДЕ не вызывается** (grep: только определение/интерфейс/тест).
- `upsertEntity` (`postgres-impl.ts:74`) делает только точный `findUnique` по `@@unique([userId, type, name])` → новое упоминание «Сериком» не находит «Серик» → **создаёт дубль**.
- `upsertEntity` **умеет** мёржить `incomingAliases` (`:91-93`) и заполнять колонку `aliases` — но `ExtractedEntityInput` (`entity-extractor.ts:24`) **не содержит `aliases`**, экстрактор их не выдаёт → колонка всегда пуста → весь alias-слой мёртв.
- Колонка `aliases String[] @default([])` уже есть в схеме (`schema.prisma`). **Миграция НЕ нужна.**

## Решения (форки, одобрено Berik 2026-06-07)
- **Стратегия склейки = FTS + эмбеддинг С ПОРОГОМ** (опция 2): Tier 1/2 (FTS имя+алиасы, russian-стеммер) принимаем как высокоточные; Tier 3 (эмбеддинг-косинус) принимаем **только если cosine-distance ≤ `MERGE_MAX_COSINE_DIST`** (консервативный дефолт, env-тюнинг). Эмбеддинг для READ/recall остаётся без порога — порог только для merge-решения.
- **Скоуп = A + B + C** (одобрено целиком).
- **За флагом `FEATURE_V2_ENTITY_RESOLVE`, off = байт-идентично. Без миграции.**

## Архитектура — 3 части

### A. Ядро: resolve-then-merge в `upsertEntity` (going-forward)
Новый метод `resolveForMerge(userId, name, type): Promise<Entity | null>` в `PostgresEntityGraph` (reuse SQL-тиров `resolveEntity`, type-filtered):
1. **Tier 1** — FTS по имени (`to_tsvector('russian', e.name) @@ plainto_tsquery('russian', $name)`), `LIMIT 1` по ts_rank → принять.
2. **Tier 2** — FTS по `unnest(aliases)` → принять.
3. **Tier 3** — эмбеддинг: `SELECT e.*, (e.embedding <=> $vec) AS dist ... ORDER BY dist LIMIT 1`; принять **только если `dist <= MERGE_MAX_COSINE_DIST`**. Если `embeddingsEnabled()` ложно — тир пропускается.
- Best-effort (любая ошибка → `null`, не бросает).
- Чистый хелпер `shouldMergeByEmbedding(dist: number, maxDist: number): boolean` (= `Number.isFinite(dist) && dist <= maxDist`) — юнит-тестируемый без БД.
- Константа `MERGE_MAX_COSINE_DIST` (дефолт `0.12` ≈ cosine-sim ≥ 0.88; env `ENTITY_MERGE_MAX_COSINE_DIST`). Консервативный старт, калибруется по проду позже.

`upsertEntity` (изменение, ON-ветка):
```
name, type нормализованы (как сейчас)
incomingAliases = isV2EntityResolveEnabled(userId) ? (entity.aliases ?? []) : []   // OFF → [] → байт-идентично
existing = findUnique(userId,type,name)            // точный матч — как сейчас (приоритет)
if existing: merge как сейчас (но aliases-мёрж тоже под флагом) → return
if isV2EntityResolveEnabled(userId):
   resolved = resolveForMerge(userId, name, type)
   if resolved:
      // слить ВХОДЯЩЕЕ в resolved + добавить новую форму имени в алиасы
      aliases' = capAliases(union(resolved.aliases, [name], incomingAliases))   // dedup, ≤20 шт, каждый ≤255
      update resolved { aliases', attributes: {...resolved.attr, ...incoming.attr}, importance: max, lastSeenAt: now }
      storeEntityEmbedding(resolved.id, resolved.name, aliases')
      return resolved
// не нашли (или флаг off) → create как сейчас (с incomingAliases, которые [] при off)
```
- **off=байт-идентично:** при `!isV2EntityResolveEnabled` → `incomingAliases=[]`, alias-мёрж пропущен, resolveForMerge не вызывается, эмбеддинг считается из (name, []) ровно как сегодня. Точный матч по имени — как сейчас.
- **Точность:** type-filtered; FTS высокоточный; эмбеддинг за порогом; новая форма имени сохраняется в `aliases` (ничего не теряем; будущие совпадения дешевле через alias-FTS).

### B. Апгрейд: экстрактор выдаёт `aliases`
- `ExtractedEntityInput.aliases?: string[]` (`entity-extractor.ts:24`).
- SYSTEM_PROMPT (`:145`): `"name"` = каноническая форма (именительный падеж, полное имя если известно) + новое поле `"aliases": ["вариант1", ...]` — известные НЕ-морфологические варианты (Серёга↔Сергей, Kaspi↔Каспи, краткое↔полное). Стеммер морфологию ловит сам, экстрактор даёт только то, что стеммер НЕ поймает.
- `parseExtractorResponse` пробрасывает `aliases` (массив строк, иначе пропустить).
- `extractEntities` нормализует каждый алиас (`normalizeEntityName`) + дропает self-ref алиасы.
- `v2-capture.ts` upsert-цикл (`:57-72`) передаёт `aliases` в `upsertEntity`.
- Экстрактор всегда выдаёт алиасы (флаг-независимо), но **использует** их только `upsertEntity` под флагом → Part B сам по себе off-safe.

### C. Бэкфилл: слить накопленные дубли (one-time, по слову Berik)
- Расширить `scripts/dedup-entities.ts` новым проходом **S3 «resolve-based»**: на юзера, группируя по `type`, для каждой сущности `resolveForMerge`-логикой (исключая саму себя по `id`) найти каноническую; собрать пары canonical/absorbed; слить **переиспользуя существующий примитив** (`entityRelationship.updateMany` переносит связи; перенести `obligation.personEntityId`; `mergeAliases`; добавить имя absorbed в aliases canonical; удалить absorbed).
- `--dry-run` (дефолт) печатает пары без изменений; `--apply --user=<id>` сливает. Запуск на прод-юзере Berik — отдельно, по явному слову, после dry-run-ревью.
- Перенос FK: подтвердить, что `EntityRelationship` (from/to), `Obligation.personEntityId`, и любые `entityRefs`-ссылки переезжают на выжившего (без сирот/потерь). MoodSnapshot.entityRefs / Memory.entityRefs — массивы строк-id: при мёрже заменить id absorbed → id canonical (best-effort, отдельный шаг).

## Поток данных
chat/voice → `extractEntities` (canonical name + aliases) → `v2-capture` upsert-цикл → `upsertEntity` (точный матч → иначе resolveForMerge → merge-или-create) → одна сущность на реальный объект → per-entity читатели (relationship-link / person-types / частоты / настроение) точны.

## Обработка ошибок
- `resolveForMerge` best-effort → `null` (как `resolveEntity`). Сбой резолва → ведём себя как «не нашли» → create (безопасный дефолт: дубль, не потеря/ложная склейка).
- Экстрактор алиасов: невалидный массив → пропустить (как сейчас parseExtractorResponse).
- Капча fire-and-forget — ошибки логируются, не ломают ответ.

## Тестирование
- **Юнит (pure, zero vi.mock):** `shouldMergeByEmbedding` (порог: dist≤max→true, >max→false, NaN→false); `capAliases` (dedup/cap/длина); `parseExtractorResponse` с `aliases` (валид/невалид/отсутствует); extractEntities нормализация+self-ref алиасов.
- **Интеграционные (реальная prisma):** склонение «Сериком» мёржится в «Серик» (Tier-1 FTS) — одна строка, alias добавлен; два разных однотипных («Серик»/«Сергей») НЕ мёржатся (порог/FTS); эмбеддинг-near-but-different за порогом НЕ мёржится; cross-user изоляция; **off-флаг: точное поведение как до фичи** (дубль создаётся, aliases пусты).
- **Структурный гард:** `upsertEntity` вызывает `resolveForMerge` за флагом; off-ветка `incomingAliases=[]`; флаг существует; экстрактор-промпт содержит `aliases`.
- **Бэкфилл-тест:** S3 находит declension-пары; merge переносит relationship/obligation FK; dry-run ничего не пишет.
- Полный verify: `tsc --noEmit` + `vitest run` + integration. Baseline ~2666 unit зелёный.

## Фазировка (план разобьёт по тирам)
- **Фаза 1 (going-forward):** A (resolveForMerge + upsertEntity-гейт) + B (экстрактор-алиасы) + флаг. Деплой → останавливает рост новых дублей. Flag сразу `all` по слову Berik.
- **Фаза 2 (clean-up):** C (бэкфилл-проход) → dry-run на проде → `--apply` по слову Berik. Сливает уже накопленное.

## Риски и контроль
| Риск | Контроль |
|------|----------|
| Ложная склейка двух разных людей | type-filtered; FTS высокоточный; эмбеддинг за консервативным порогом 0.12; порог env-тюнится; сохраняем форму имени в alias (видно, что слили) |
| Поломка hot-path капчи | флаг off=байт-идентично; best-effort→create при сбое; +1-3 запроса/сущность на ФОНОВОЙ капче (не блокирует ответ) |
| Потеря данных при бэкфилле | dry-run дефолт; перенос ВСЕХ FK (relationship/obligation/entityRefs) на выжившего перед удалением; --apply только по слову Berik |
| off не идентичен | юнит/it-тест off-ветки; incomingAliases форсятся в [] при off |
| Стеммер не сводит редкое имя | backstop: alias-FTS (форма попадает в alias при первом мёрже) + экстрактор-алиасы (Part B) |

## Rollout
Коммит на шаг (TDD: test→red→impl→green→tsc→commit, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`). Push/deploy/флаг/`--apply` бэкфилла — ТОЛЬКО по явному слову Berik. Флаг сразу `all` при включении.
