# F2 — Явная коррекция (super-седация памяти) — Design Spec

> Дата: 2026-06-10. Ветка-источник: **main**. Server-only (`packages/server`).
> Контекст: memory-качество, диагноз `docs/diagnostics/2026-06-07-memory-quality-diagnosis.md` (F2). Berik выбрал **Tier 0 — только явная коррекция** (самый безопасный срез).

**Goal:** Когда юзер ЯВНО отменяет/исправляет прежний факт («бросил кофе», «переехал», «это не так»), бот **инвалидирует** старую противоречащую память (обратимо, `invalidAt`), а не копит «люблю кофе» + «бросил кофе» вечно.

**Architecture:** Чат-экстрактор (за флагом) помечает явную коррекцию топиком `supersedesTopic`; после записи нового факта `captureInBackground` ищет ЕДИНСТВЕННУЮ сильную same-type память по этому топику и инвалидирует её через существующий `invalidateEvent`. Читатель уже чтит `invalidAt` (F3, `FEATURE_V2_FORGET=all`) → инвалидированное исчезает из recall. Всё за флагом `FEATURE_V2_SUPERSEDE`, off=байт-идентично.

**⚠️ Принцип риска:** это ЕДИНСТВЕННЫЙ срез, где баг = СПРЯТАТЬ правду (бот «забыл» реальный факт) = регресс по оси «всё реально». Поэтому: только явный сигнал, обратимо (`invalidAt`, не delete), **единственный-сильный-матч-или-скип** (при неоднозначности НЕ прячем).

**Tech Stack:** Fastify + Prisma6 + Postgres, ESM `.js`, TS strict no `any`, vitest, zero `vi.mock`, `createAnthropic()`. Коммит-на-шаг, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Ключевая ловушка (определяет дизайн)
`plainto_tsquery` — это AND. «бросил кофе» = `'брос' & 'коф'`. Старая «люблю кофе» имеет `'коф'`, но НЕ `'брос'` → `@@` = FALSE → **поиск по новому тексту НЕ найдёт противоречие.** Контрадикшн в ГЛАГОЛЕ, общее — в СУЩЕСТВИТЕЛЬНОМ. → Искать по **ТОПИКУ** («кофе»), который эмитит экстрактор отдельно от текста.

## Текущее (проверено на main)
- `invalidateEvent(eventId, invalidAt=now)` (`episodic-memory.ts:359`) — ставит `invalidAt`. **0 вызовов** (мёртвый выключатель — включаем).
- Читатель `getRelevantMemories` (`memory-service.ts:153`, за `FEATURE_V2_FORGET=all`) чтит `invalidAt` → инвалидированное вне recall. **Read-side готов.**
- `captureInBackground` (`jarvis-orchestrator.ts:196-208`) пишет чат-память через `writeMemory` (возвращает `{id, action}`).
- `extractFromChat` возвращает `Pick<DictationExtraction,'tasks'|'memories'>`; `memories: ExtractedMemory[]`.

---

## Флаг
`feature-flags.ts` — новый (зеркало `isV2MemGraphEnabled`):
```ts
/**
 * F2 явная коррекция: при ЯВНОЙ отмене факта инвалидируем старую противоречащую
 * память (обратимо). OFF → экстрактор не детектит supersede + шаг инвалидации
 * выключен → байт-идентично.
 */
export function isV2SupersedeEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_SUPERSEDE, userId);
}
```

## Юнит A — экстрактор помечает явную коррекцию

### Поле в `ExtractedMemory`
`dictation-service.ts` — добавить опц. поле (диктовка его НЕ ставит → off-identical для голоса):
```ts
// в interface ExtractedMemory:
  /** F2: если это ЯВНАЯ коррекция прежнего факта — короткий топик для ретайра
   *  старой памяти («кофе», «город», «работа в X»). Иначе отсутствует. */
  supersedesTopic?: string;
```

### `extractFromChat` — флаг-гейт промпта
`dictation-service.ts` — сигнатуру дополнить `opts?: { detectSupersede?: boolean }`. Когда `detectSupersede` (флаг on) — в систем-промпт добавить блок:
```
ЯВНАЯ КОРРЕКЦИЯ (supersedesTopic): если пользователь ПРЯМО отменяет/меняет прежний факт
о себе — глаголами «бросил / больше не / уже не / перестал / развёлся / переехал / раньше…
теперь» — у соответствующей memory добавь поле "supersedesTopic": короткий ТОПИК для поиска
старой записи (1-2 слова: «кофе», «город проживания», «работа в X»). НЕ полную фразу.
Только при ЯВНОМ сигнале отмены. Сомнение / обычное утверждение → НЕ добавляй supersedesTopic.
```
Когда `detectSupersede` ложно (флаг off) — промпт ровно прежний (байт-идентично). Парсер уже мапит `parsed.memories` — `supersedesTopic` пройдёт как опц. поле.

## Юнит B — поиск + инвалидация

### `supersedeByTopic` в `episodic-memory.ts` (рядом с `invalidateEvent`)
```ts
/** F2 floor: топик-матч обычно одно-токенный (≈0.06). Главная защита —
 *  единственный-сильный-матч, порог лишь отсекает near-zero шум. КАЛИБРУЕТСЯ. */
const SUPERSEDE_MIN_RANK = 0.03;

/**
 * F2: найти ЕДИНСТВЕННУЮ сильную same-type не-инвалидированную память по топику
 * и инвалидировать её (обратимо). 0 / >1 / слабый матч → НЕ трогаем (возврат null).
 * excludeId — только что записанный новый факт.
 */
export async function supersedeByTopic(
  userId: string,
  type: string,
  topic: string,
  excludeId: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string; rank: number }>>`
    SELECT m.id,
      ts_rank(to_tsvector('russian', coalesce(m.content, '')), plainto_tsquery('russian', ${topic})) AS rank
    FROM "Memory" m
    WHERE m."userId" = ${userId} AND m.type = ${type} AND m.id <> ${excludeId}
      AND m."invalidAt" IS NULL
      AND to_tsvector('russian', coalesce(m.content, '')) @@ plainto_tsquery('russian', ${topic})
    ORDER BY rank DESC
    LIMIT 3;`;
  const strong = rows.filter((r) => r.rank >= SUPERSEDE_MIN_RANK);
  if (strong.length !== 1) return null; // 0 / неоднозначно (>1) → СКИП (не прячем не ту)
  await invalidateEvent(strong[0].id);
  console.warn(`[memory] SUPERSEDE type=${type} topic="${topic}" invalidated=${strong[0].id} (user=${userId})`);
  return strong[0].id;
}
```
(`invalidateEvent` бьёт по `id` — `id` принадлежит юзеру, т.к. запрос фильтрует `userId`.)

### Врезка в `captureInBackground`
`jarvis-orchestrator.ts:196-208` — захватить результат writeMemory + supersede-шаг:
```ts
for (const m of extracted.memories) {
  const r = await writeMemory(userId, {
    type: m.type, content: m.content, details: m.details ?? null,
    source: 'chat', tags: m.tags, importance: m.importance,
  });
  memories++;
  if (isV2SupersedeEnabled(userId) && m.supersedesTopic && r.action !== 'skipped') {
    await supersedeByTopic(userId, m.type, m.supersedesTopic, r.id).catch(() => null); // best-effort
  }
}
```
И передать флаг в экстрактор: вызов `extractFromChat(text, name, { detectSupersede: isV2SupersedeEnabled(userId) })`.
**off** → `m.supersedesTopic` не эмитится (промпт off) И шаг выключен → DB идентично. Импорты: `isV2SupersedeEnabled` (`../lib/feature-flags.js`), `supersedeByTopic` (`./episodic-memory.js`).

## Калибровка порога
Перед финалом — измерить `ts_rank('кофе' vs 'люблю кофе')` и пару топик-vs-факт на тест-БД (как делали для дедупа). `SUPERSEDE_MIN_RANK` — НИЖЕ легитимного топик-матча (≈0.06), но выше near-zero. Главная защита — single-match, не порог.

## Обработка ошибок
- `supersedeByTopic` best-effort (`.catch`); `captureInBackground` уже fire-and-forget. Сбой supersede не роняет ответ и не блокирует запись.
- Инвалидация ОБРАТИМА (`invalidAt`, не delete) — ложный супер-сед можно вернуть.

## Тесты
**Unit:** `isV2SupersedeEnabled` (флаг); структурный — `extractFromChat` промпт содержит supersede-блок + правило «сомнение → НЕ добавляй»; `ExtractedMemory` имеет `supersedesTopic?`; `captureInBackground` имеет флаг-гейт `supersedeByTopic` + проброс `detectSupersede`; `supersedeByTopic` существует в episodic-memory.
**Integration (`mem-supersede.it.test.ts`):**
- Пишем preference «люблю кофе» → второй writeMemory + `supersedeByTopic(uid,'preference','кофе',newId)` (флаг on) → старая `invalidAt` выставлен; `getRelevantMemories` (FORGET=all) её не отдаёт.
- Неоднозначность: «люблю кофе» + «кофе с молоком вкусный» → `supersedeByTopic` возвращает null, обе живы (single-match guard).
- Несуществующий топик → null.
- **OFF (FEATURE_V2_SUPERSEDE unset):** supersede-путь не вызывается (через captureInBackground-структуру) → обе памяти живут. (прямой вызов `supersedeByTopic` флагом не гейтится — гейт на стороне captureInBackground; it зовёт функцию напрямую для A/B логики, флаг проверяется структурно.)
- cross-user изоляция.

## Декомпозиция (файлы)
| Файл | Изменение |
|------|-----------|
| `src/lib/feature-flags.ts` (+test) | `isV2SupersedeEnabled` |
| `src/services/dictation-service.ts` | `supersedesTopic?` в `ExtractedMemory`; `extractFromChat` opts+промпт-блок |
| `src/services/episodic-memory.ts` | `SUPERSEDE_MIN_RANK` + `supersedeByTopic` |
| `src/services/jarvis-orchestrator.ts` | `captureInBackground`: проброс detectSupersede + supersede-шаг **(прод хот-путь чата)** |
| `src/services/mem-supersede-wiring.test.ts` (new) | структурный гард |
| `src/services/mem-supersede.it.test.ts` (new) | интеграция A/B |

## Rollout
Коммит-на-шаг (atomic TDD). Полный verify + независимое ревью (фокус: off=байт-идентично; single-match-или-скип; обратимость; промпт консервативен; supersede best-effort вне критич. пути). `push`/`deploy`/`FEATURE_V2_SUPERSEDE=all` — ТОЛЬКО по слову Berik.

## Граница (честно)
- **Только ПАМЯТЬ** (fact/preference/decision/person), same-type. Голос (диктовка) supersede НЕ детектит (поле не ставит).
- **Связи-отношения** (entity-links: «уже не работаю с X» как link, «развёлся») — СЛЕДУЮЩИЙ срез (нужен `invalidateLink`; связи сейчас без пути ретайра).
- **Не чинит «Камилу»** (пассивный устаревший мусор — это decay/cleanup, отдельно).
- **Остаточный риск:** промах по топику или ложный detect → скрыть не ту память. Гасим: явный-сигнал-промпт + single-match + строгий floor + обратимость + лог. Не ноль — поэтому скип при неоднозначности.
