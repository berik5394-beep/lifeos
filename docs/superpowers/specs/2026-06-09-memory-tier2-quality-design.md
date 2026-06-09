# Memory Tier-2 «Качество факт-памяти» — Design Spec

> Дата: 2026-06-09. Ветка-источник: **main**. Server-only (`packages/server`).
> Скоуп закреплён Berik: закрыть **всю** Tier-2 одним заходом (T4+T3+T5+E2), одна спека → один план → один пуш, «чтобы не возвращаться».
> Развилка закреплена Berik: чат-экстрактор **консервативный** — «не уверен → молчим» (точность > полнота).

**Goal:** Починить весь конвейер факт-памяти — честный **ввод** (T4+T3), бережное **обновление** (T5), значимое **чтение** (E2) — так, чтобы бот перестал запоминать выдуманный мусор и перестал терять важное.

**Architecture:** 4 точечных изменения в существующем конвейере памяти, все за ОДНИМ флагом `FEATURE_V2_MEM_QUALITY`. `off` = байт-идентично сегодняшнему поведению во всех 4 точках (доказывается off-ветками + тестами). Память остаётся best-effort: любой сбой извлечения/записи/чтения НИКОГДА не роняет ответ пользователю.

**Tech Stack:** Fastify + Prisma6 + Postgres(+pgvector), ESM (`.js`-суффиксы в импортах), TypeScript strict (no `any`), vitest (unit `*.test.ts` esbuild-no-typecheck; integration `*.it.test.ts` на тест-БД localhost:5433), zero `vi.mock`, `createAnthropic()`. Коммит-на-шаг, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Корень проблемы (проверено живьём на `main`)

| # | Дыра | Точка | Что сейчас |
|---|------|-------|-----------|
| **T4** | Чат-сообщения извлекаются «диктофонным» промптом → выдуманные person/fact/emotion из коротких реплик | `jarvis-orchestrator.ts:167` (`captureInBackground` зовёт `extractFromTranscript`) | Промпт `extractFromTranscript` (dictation-service.ts:88-117) начинается с «Юзер только что наговорил тебе свободную речь через диктофон» и активно извлекает 7 типов, включая `emotion`. Гейт `looksCaptureWorthy` (orch:114) отсекает болтовню, но прошедшее — раздувается. |
| **T3** | Диктовка пишет память в обход `writeMemory` — без дедупа/embedding/TTL | `dictation-service.ts:216-232` (`tx.memory.create` внутри `$transaction`) | Память диктовки не дедуплицируется, не эмбеддится (семантический recall её НЕ находит), не получает `expiresAt`. |
| **T5** | `details` затирается бедным новым значением при dedup-update (в отличие от `content`) | `episodic-memory.ts:194` (`const merged = details ?? existing.details`) | `content` защищён `shouldOverwriteContent` (:200), а `details` — нет: любой non-null новый `details` перезаписывает богатый старый. tags-union и importance-max уже корректны. |
| **E2** | Память в промпт = 6 самых СВЕЖИХ, важность игнорируется → важное старое не всплывает | `v2-enrichment.ts:423` (`recentEvents(userId, 6)`), reader `episodic-memory.ts:357` (`orderBy createdAt desc`) | `recentEvents` уважает `invalidAt`/`expiresAt` (forgetting — сохраняем), но сортирует только по свежести. |

Связь: это **конвейер памяти** — ввод → обновление → чтение. Мусор-на-входе бьёт всё дальше, поэтому чиним все стадии разом.

---

## Флаг

`packages/server/src/lib/feature-flags.ts` — добавить (зеркало `isV2AntiFabEnabled`):

```ts
/**
 * Tier-2 «качество факт-памяти» (T4+T3+T5+E2): консервативный чат-экстрактор,
 * диктовка через writeMemory, sparse-guard на details, ранжирование чтения
 * по значимости. OFF → всё байт-идентично прежнему поведению.
 */
export function isV2MemQualityEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_MEM_QUALITY, userId);
}
```

`isEnabledForUser(envValue, userId)` — существующий хелпер (принимает `all`/`user-${id}`-csv; `none`/`''`/unset → false). Один флаг на все 4 юнита: проще («закрыли разом»), а off-байт-идентичность делает blast-radius безопасным.

---

## Юнит T4 — Честный ввод из чата *(сердце)*

### Новая функция `extractFromChat`
`packages/server/src/services/dictation-service.ts` — рядом с `extractFromTranscript`, тот же Claude-вызов + парсинг + `AiModelError`, но **консервативный системный промпт** и **узкий тип возврата** (нет фейкового summary/spokenResponse):

```ts
export async function extractFromChat(
  text: string,
  userName: string,
): Promise<Pick<DictationExtraction, 'tasks' | 'memories'>> {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];

  const systemPrompt = `Ты — фоновый экстрактор памяти ассистента ${userName}. Пользователь написал тебе сообщение в ЧАТЕ (обычная переписка, не диктофон, не монолог). Извлеки ТОЛЬКО то, что действительно стоит запомнить надолго, и верни строгий JSON.

Текущая дата: ${today}. "завтра" = ${tomorrow}.

ГЛАВНОЕ ПРАВИЛО: точность важнее полноты. Сомневаешься — НЕ извлекай. Лучше пустой массив, чем выдуманный факт. Не достраивай, не предполагай, не «читай между строк».

Верни ТОЛЬКО валидный JSON без markdown:
{
  "tasks": [ { "title": "...", "date": "YYYY-MM-DD", "time": "HH:MM|null", "category": "work|personal|health|finance|education|home", "priority": "low|medium|high|critical", "notes": "опц." } ],
  "memories": [ { "type": "fact|decision|event|person|place|preference", "content": "короткая суть", "details": "опц.", "tags": ["..."], "importance": 4-10 } ]
}

МОЖНО в memories (только явное, прямо сказанное пользователем):
- fact — конкретный факт, прямо названный («У мамы день рождения 15 марта»)
- decision — принятое решение («Решил уволиться», «Договорились в субботу»)
- event — конкретное прошедшее событие («Был на встрече с инвестором»)
- person — человек, явно названный по имени с контекстом («Познакомился с Айгерим, она дизайнер»)
- place — конкретное место с контекстом («Хорошее кафе на Розыбакиева»)
- preference — устойчивое предпочтение, прямо высказанное («Не люблю острое»)

НЕЛЬЗЯ (верни пусто):
- эмоции/настроение («устал», «тревожно», «отлично») — НЕ извлекаем вообще
- мимолётные реплики, вопросы, болтовню («ок», «спасибо», «не знаю»)
- неуверенное/гипотетическое («наверное», «может быть», «если получится»)
- то, что ты сам додумал из контекста

importance: 4-6 обычный факт, 7-10 важное (семья, здоровье, крупные решения). Мелочь (<4) НЕ пиши вообще.

tasks: только ЯВНОЕ дело, прямо озвученное («купить продукты», «позвонить врачу»). Вопрос «как мне начать бегать?» — НЕ задача. Сомнение → не создавай. Дата по умолчанию — сегодня.

Запоминать нечего → верни {"tasks": [], "memories": []}.`;

  const response = await anthropic.messages.create({
    model: MODELS.sonnet,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: text }],
  });
  const content = response.content[0];
  if (!content || content.type !== 'text') {
    throw new AiModelError(new Error('Empty Claude response'));
  }
  // Тот же defensive-парсинг, что в extractFromTranscript (dictation-service.ts:131-140):
  // снять markdown-fence + JSON.parse в try/catch. (param зовётся `text` → используем `raw`.)
  let raw = content.text.trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Pick<DictationExtraction, 'tasks' | 'memories'>>;
    return { tasks: parsed.tasks ?? [], memories: parsed.memories ?? [] };
  } catch (err) {
    throw new AiModelError(err instanceof Error ? err : new Error(String(err)));
  }
}
```

- Парсинг — точная копия блока `extractFromTranscript` (строки 131-140): trim → снять ```-fence → `JSON.parse` в `try/catch` с `AiModelError`. Никаких новых символов.
- Тип возврата — `Pick<DictationExtraction, 'tasks' | 'memories'>`: переиспользует элементные типы, не плодит фейковые `summary`/`spokenResponse`.

### Врезка (за флагом)
`packages/server/src/services/jarvis-orchestrator.ts:167` — внутри `captureInBackground`:

```ts
const extracted = isV2MemQualityEnabled(userId)
  ? await extractFromChat(text, user?.name || 'друг')
  : await extractFromTranscript(text, user?.name || 'друг');
```

- `off` → `extractFromTranscript` (как сегодня, байт-идентично).
- Гейт `looksCaptureWorthy(text)` (вызывающая сторона, orch:1168) НЕ трогаем — он остаётся дешёвым пред-фильтром без Claude-вызова на «ок».
- Дальше `captureInBackground` использует `extracted.tasks` / `extracted.memories` — обе формы совпадают, поток не меняется. Память по-прежнему пишется через `writeMemory` (M3, orch:196).

### Побочный эффект (намеренный, за флагом)
Консервативный экстрактор также делает извлечение ЗАДАЧ из чата строже (только явные действия) → меньше фантомных фоновых задач. Это улучшение, не регрессия; `off` оставляет прежнее поведение.

---

## Юнит T3 — Диктовка через `writeMemory`

`packages/server/src/services/dictation-service.ts` — функция, содержащая `$transaction` (строки ~195-235). Флаг-branch, **сохраняющий контракт ответа** (`memoriesCreated` той же формы):

```ts
if (isV2MemQualityEnabled(userId)) {
  // Задачи — в транзакции (как сейчас). Память — ВНЕ tx через writeMemory
  // (дедуп + embedding + TTL). Зеркалит chat-паттерн (orch: «память вне tx»).
  const result = await prisma.$transaction(async (tx) => {
    const createdTasks = await Promise.all(
      extracted.tasks.map((t) => tx.task.create({ /* ...как сейчас... */ })),
    );
    return { session, createdTasks };
  });
  const createdMemories: Array<{ id: string; type: string; content: string; importance: number; tags: string[] }> = [];
  for (const m of extracted.memories) {
    const r = await writeMemory(userId, {
      type: m.type,
      content: m.content,
      details: m.details ?? null,
      source: 'dictation',
      sourceId: result.session.id,
      tags: m.tags,
      importance: m.importance ?? 5,
    });
    if (r.action !== 'skipped') {
      createdMemories.push({
        id: r.id,
        type: m.type,
        content: m.content.slice(0, 500),
        importance: m.importance ?? 5,
        tags: (m.tags || []).slice(0, 10).map((t) => t.slice(0, 32)),
      });
    }
  }
  return { sessionId: result.session.id, transcript, summary: extracted.summary, spokenResponse: extracted.spokenResponse, tasksCreated: result.createdTasks, memoriesCreated: createdMemories };
} else {
  // ...существующий путь: задачи+память в одном $transaction через tx.memory.create...
}
```

- `off` → существующий код без изменений (память через `tx.memory.create`), байт-идентично.
- `writeMemory` уже глотает ошибки (`action:'skipped'`) — диктовка не падает при сбое памяти.
- Эффект: диктовка-память дедуплицируется (STABLE_TYPES), эмбеддится (семантический recall находит), получает `expiresAt`/`validAt`.

---

## Юнит T5 — Sparse-guard на `details`

### Новый чистый хелпер `mergeDetails`
`packages/server/src/services/memory-service.ts` — рядом с `shouldOverwriteContent` (co-locate guards):

```ts
/**
 * Guard против sparse-overwrite для details (T5): новый бедный details
 * НЕ должен затирать богатый старый. Зеркалит shouldOverwriteContent.
 *  - оба пусты → null
 *  - один пуст → другой
 *  - оба есть → более богатый (по shouldOverwriteContent); сомнение → старый
 */
export function mergeDetails(
  oldDetails: string | null,
  newDetails: string | null,
): string | null {
  if (!newDetails) return oldDetails;
  if (!oldDetails) return newDetails;
  return shouldOverwriteContent(oldDetails, newDetails) ? newDetails : oldDetails;
}
```

### Врезка (за флагом)
`packages/server/src/services/episodic-memory.ts:194`:

```ts
const merged = isV2MemQualityEnabled(userId)
  ? mergeDetails(existing.details, details)
  : (details ?? existing.details);
```

- `off` → `details ?? existing.details` (байт-идентично).
- Импорт `mergeDetails` из `./memory-service.js`, `isV2MemQualityEnabled` из `../lib/feature-flags.js`.
- tags (union) и importance (max) НЕ трогаем — уже корректны.

---

## Юнит E2 — Значимость при чтении

### Новые: чистый `rankBySignificance` + `significantMemories`
`packages/server/src/services/episodic-memory.ts` — рядом с `recentEvents`:

```ts
type RankableMemory = { id: string; type: string; content: string; createdAt: Date; importance: number };

/** Pure: скор = importance + recency-бонус; сортировка desc, тай-брейк по свежести. */
export function rankBySignificance<T extends RankableMemory>(
  rows: T[],
  limit: number,
  now: Date,
): T[] {
  const score = (r: T): number => {
    const ageDays = (now.getTime() - r.createdAt.getTime()) / 86_400_000;
    const recencyBonus = ageDays <= 2 ? 2 : ageDays <= 7 ? 1 : 0;
    return r.importance + recencyBonus;
  };
  return [...rows]
    .sort((a, b) => score(b) - score(a) || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, Math.max(1, limit));
}

/**
 * Кандидаты = свежие ∪ высоко-важные (оба с invalidAt/expiry-фильтрами,
 * как recentEvents), дедуп по id, ранжирование по значимости → топ-limit.
 * Важное старое всплывает; свежий контекст не теряется.
 */
export async function significantMemories(
  userId: string,
  limit = 6,
): Promise<Array<{ type: string; content: string; createdAt: Date }>> {
  const now = new Date();
  const baseWhere = { userId, invalidAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
  const sel = { id: true, type: true, content: true, createdAt: true, importance: true } as const;
  const [recent, important] = await Promise.all([
    prisma.memory.findMany({ where: baseWhere, orderBy: { createdAt: 'desc' }, take: 15, select: sel }),
    prisma.memory.findMany({ where: baseWhere, orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }], take: 10, select: sel }),
  ]);
  const byId = new Map<string, RankableMemory>();
  for (const r of [...recent, ...important]) byId.set(r.id, r);
  return rankBySignificance([...byId.values()], limit, now).map(
    ({ type, content, createdAt }) => ({ type, content, createdAt }),
  );
}
```

### Врезка (за флагом)
`packages/server/src/services/v2-enrichment.ts:423`:

```ts
(isV2MemQualityEnabled(userId)
  ? significantMemories(userId, 6)
  : recentEvents(userId, 6)
).then((rows) => formatRecentActivitySection(rows) || null),
```

- `off` → `recentEvents(userId, 6)` (байт-идентично).
- `recentEvents` НЕ меняем (используется как generic reader в других местах).
- `formatRecentActivitySection` принимает `{content}[]` — обе формы подходят. Позицию секции в блоке не трогаем (блок не обрезается downstream — YAGNI).

---

## Обработка ошибок

- `extractFromChat` — `try/catch` как `extractFromTranscript`; сбой → `captureInBackground` уже fire-and-forget с `.catch` (orch:1173). Ответ юзеру не страдает.
- T3 — `writeMemory` возвращает `skipped` при сбое (не бросает); диктовка завершается, память best-effort.
- T5/E2 — чистые функции + индексированные запросы; ранжирование в JS не бросает.
- Принцип: **память никогда не критический путь ответа**.

## Стратегия тестов

**Unit (`*.test.ts`, esbuild, без БД):**
- `extractFromChat`: парсинг валидного JSON; пустой/мусорный ответ → `{tasks:[],memories:[]}`; структурный — промпт содержит «точность важнее полноты», запрет `emotion`, «Сомневаешься — НЕ извлекай».
- `mergeDetails`: оба null→null; old=null→new; new=null→old; оба есть и new богаче→new; new беднее (<70%)→old; old<30 симв→new.
- `rankBySignificance`: важное старое обходит свежий пустяк; тай-брейк по свежести; limit; пустой вход.
- `isV2MemQualityEnabled`: `all`→true; unset/`none`/`''`→false; csv `user-X`.
- **Структурный гард (4 точки):** `dictation-service.ts` содержит `extractFromChat` + флаг-branch с `writeMemory`; `jarvis-orchestrator.ts` captureInBackground имеет флаг-тернар `extractFromChat`/`extractFromTranscript`; `episodic-memory.ts:194` имеет флаг-branch `mergeDetails`; `v2-enrichment.ts` имеет флаг-branch `significantMemories`/`recentEvents`. (Доказывает наличие off-ветки.)

**Integration (`*.it.test.ts`, тест-БД):**
- T3: вызвать диктовку-память-путь (или `writeMemory` напрямую дважды с похожим content type=fact) → одна запись (дедуп), embedding присутствует.
- T5: `writeMemory` существующего богатого `details`, затем тем же content + бедный `details` → `details` НЕ затёрт (остался богатый); затем богаче → обновился.
- E2: создать важную старую (importance 9, createdAt −10д) + 6 свежих пустяков (importance 3) → `significantMemories(userId,6)` включает важную старую.
- Cross-user: чужие записи не видны.

Baseline ~2611 unit зелёный должен остаться зелёным; `tsc` чисто на каждом шаге.

## Декомпозиция (файлы)

| Файл | Изменение |
|------|-----------|
| `src/lib/feature-flags.ts` | + `isV2MemQualityEnabled` (+ unit) |
| `src/services/memory-service.ts` | + `mergeDetails` pure (+ unit) |
| `src/services/dictation-service.ts` | + `extractFromChat`; T3 флаг-branch (память через `writeMemory`) |
| `src/services/jarvis-orchestrator.ts` | `captureInBackground`: флаг-выбор экстрактора **(CRITICAL — горячий прод-путь чата)** |
| `src/services/episodic-memory.ts` | T5 флаг-branch `mergeDetails` (:194); + `rankBySignificance` pure + `significantMemories` (E2) |
| `src/services/v2-enrichment.ts` | E2 флаг-branch `significantMemories`/`recentEvents` (:423) |
| тесты | unit + структурный гард + 1 it-файл |

## Rollout

- Коммит-на-шаг (atomic TDD: red→green→tsc→commit). Полный verify в конце + независимое ревью (фокус: off=байт-идентично в 4 точках; память не на критическом пути; контракт ответа диктовки сохранён; консервативность промпта).
- `push` / `deploy` / флаг `FEATURE_V2_MEM_QUALITY=all` — ТОЛЬКО по явному слову Berik. Флаг сразу `=all` (ship→flag=all).

## Граница (чтобы «не возвращаться» было правдой)

Этот заход закрывает **весь конвейер факт-памяти** — ввод (T4+T3) / обновление (T5) / чтение (E2). Снаружи остаются ТОЛЬКО:
- **E1** (персона-инъекция) — приоритет #3 (голос/непрерывность), требует анти-фаб-гард до включения. Отдельная ось, не баг качества.
- **F2** (контрадикшн фактов) — осознанно отложен как рискованный («только явная коррекция»).

Качество факт-памяти Tier-2 — **закрыто**.
