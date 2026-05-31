# v2 Phase B3 — Cross-Session Learning (Feedback Loop) — Design Spec

**Status:** DRAFT → awaiting Berik approval
**Author:** Claude (subagent-driven)
**Date:** 2026-05-31
**Depends on:** B1 (USER axes) shipped + live, B2 (BOT traits) shipped + live
**Quality bar:** «Умный Джарвис» — no халтура.

---

## 1. Context & Motivation

Сегодня LifeOS учится о пользователе **из содержания** его сообщений
(B1: «опять не успел» → self_discipline down). Но он **не учится из
реакции пользователя на собственные ответы бота.**

Пример провала, который B3 закрывает:

```
Бот:  «Слушай, ты третий день срываешь тренировку. Соберись — это же
       была твоя цель. Что мешает?»          ← directness высокая
Юзер: «Можно без нравоучений? Мне и так тяжело.»   ← НЕГАТИВНАЯ реакция
Бот:  (сегодня) никак не учитывает это. Завтра снова давит.
      (B3) понимает: «мой прямой тон не зашёл» →
      conflict_tolerance юзера НИЖЕ оценки → axes корректируются →
      B2 traits.directness падает → бот мягчает. Сам. Без настройки.
```

Это и есть «friend that remembers and evolves» из north-star: бот не
просто помнит факты — он **помнит, что сработало, а что обидело**, и
меняет манеру. Joi-like: никаких кнопок 👍/👎, никаких «оцените ответ».
Чисто пассивное наблюдение за естественной реакцией.

### Связь с north-star (memory + proactivity = ядро)
- **Memory**: реакции = новый класс памяти — «как я повлиял на него».
- **Proactivity**: научившись, бот проактивно меняет подход, а не ждёт
  команды «будь мягче».
- **Interconnected**: B3 не вводит новый «мозг» — он **вливается в тот
  же B1 axes store**, который уже управляет и контентом (B1), и тоном
  (B2). Один источник правды.

---

## 2. Scope & Non-Goals

### In scope (locked by Berik 2026-05-31)
- ✅ **Пассивная natural-language детекция** — без кнопок, без
  навязчивых вопросов. Бот сам распознаёт реакцию в обычном тексте.
- ✅ **Все 3 типа сигнала**:
  1. **explicit** — словесная реакция («слишком жёстко», «спасибо,
     помог», «ты не понял»). Claude haiku classifier.
  2. **implicit mood-drop** — настроение юзера упало сразу после хода
     бота. Reuse B-tier `MoodSnapshot` (emotional-memory).
  3. **implicit re-ask** — юзер переспрашивает то же самое → прошлый
     ответ бота не зашёл. Voyage embeddings (оплачены) + cosine.
- ✅ **Коррекция через B1 axes** — feedback → `AxisSignal(source='feedback')`
  → reuse B1 EWMA. B2 traits следуют автоматически.
- ✅ **CorrectionLog** — append-only audit для прозрачности (/axes
  показывает «когда и как я тебя скорректировал»).
- ✅ Feature flag `isV2FeedbackEnabled` — gradual rollout (Berik first).

### Non-Goals (явно НЕ делаем в B3)
- ❌ **Прямое редактирование B2 traits.** Traits детерминированы:
  `traits = f(axes, depth)`. `refreshTraits` перезатёр бы любой прямой
  правкой. Поэтому feedback **только** двигает axes. Это сознательное
  архитектурное решение (см. §3.2).
- ❌ Кнопки / рейтинги / опросы. (Berik: пассивно.)
- ❌ Bootstrap из истории. Feedback forward-looking — учимся с момента
  включения флага. (Прошлые реакции не переразбираем — нет ground truth
  что бот тогда сказал в нужном формате, и это не стоит сложности.)
- ❌ Отдельный «preference store» для стиль-команд. «Будь прямее» —
  это тоже axis-сигнал (CT up), течёт через тот же канал. (§3.3)
- ❌ Обучение на реакциях для proactivity-тайминга (KAIROS gates). B4+.

---

## 3. Core Architecture

### 3.1 Единый принцип: всё течёт через B1 axes

```
                  user message (реакция на ход бота)
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
     mood-drop flag      re-ask flag      (raw text)
     (MoodSnapshot Δ)   (Voyage cosine)        │
            │                 │                 │
            └────────┬────────┴─────────────────┘
                     ▼
          FeedbackClassifier (Claude haiku)
          вход:  botLastMsg + userMsg + implicit-флаги
          выход: { isReaction, valence, dimension,
                   axisSignals[], styleNote?, summary }
                     │
          ┌──────────┴───────────┐
          ▼                      ▼
   recordSignals(             CorrectionLog.create
     source='feedback')        (audit/transparency)
          │
          ▼
   B1 UserAxes (EWMA α=0.05)  ← ТОТ ЖЕ store, что B1/B2
          │
          ▼
   B2 refreshTraits = f(axes, depth)   ← бот мягчает/твердеет САМ
```

**Почему mood-drop и re-ask НЕ генерируют axis-сигналы напрямую:**
они неоднозначны по оси (упавшее настроение не говорит *какая* ось
виновата). Поэтому они работают как **контекст-флаги, обогащающие
classifier** — единственную точку, которая reasoning'ом сопоставляет
реакцию ↔ ось. Это убирает дубль-логику и ложные срабатывания.

### 3.2 Почему feedback двигает axes, а не traits напрямую

B2 формула (зафиксирована, live):
```
warmth      = 0.45 + 0.30·userEO + 0.25·depth
directness  = 0.30 + 0.45·userCT + 0.25·depth
humor       = 0.20 + 0.50·depth  + 0.15·userEO
playfulness = 0.30 + 0.30·depth  + 0.20·userEO
```
`refreshTraitsIfStale` пересчитывает traits из axes на каждом stale-тике.
Если бы feedback писал `directness -= 0.1` прямо в `BotIdentity.traits`,
следующий refresh **затёр бы** правку. Двигая `conflict_tolerance` вместо
этого, мы получаем **устойчивую** коррекцию: ось ниже → формула даёт
directness ниже → и так будет держаться, пока axes такие.

Это и есть «interconnected, один мозг»: feedback не воюет с traits-моделью,
он кормит её вход.

### 3.3 Стиль-команды = axis-сигналы

| Реплика юзера | Что это значит про ось | Сигнал |
|---|---|---|
| «будь прямее / скажи как есть» | юзер выдержит/хочет pushback | conflict_tolerance **+** |
| «без нравоучений / мягче» | прямой тон не зашёл | conflict_tolerance **−** |
| «не философствуй, давай конкретику» | не хочет рефлексии | introspection_depth **−** |
| «помоги разобраться почему» | хочет глубже копать | introspection_depth **+** |
| «можешь без эмоций, по делу» | factual mode | emotional_openness **−** |
| «спасибо, реально поддержал» | тёплый тон зашёл | emotional_openness **+** (слабо) |

EWMA α=0.05 гарантирует: одна реплика чуть двигает ось (transient mood
не ломает профиль), повторяющийся паттерн накапливается. Самокорректируется.

---

## 4. Data Model

### 4.1 `AxisSignalSource` — добавить `'feedback'`

`src/services/user-axes/types.ts` (additive):
```ts
export type AxisSignalSource =
  | 'claude_classifier'
  | 'system_signal'
  | 'bootstrap'
  | 'manual'
  | 'feedback';      // ← B3
```
Никаких других изменений в B1 — `recordSignals` уже принимает `source`.

### 4.2 `CorrectionLog` — новая таблица (append-only audit)

```prisma
model CorrectionLog {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  // Что юзер сказал в реакции (его сообщение).
  userMsgId     String?
  // На какой ход бота это реакция (excerpt, не FK — ChatMessage может
  // быть purged retention'ом; храним текст-снимок до 280 симв).
  botExcerpt    String
  userExcerpt   String
  // Классификация.
  signalType    String   // 'explicit' | 'mood_drop' | 're_ask'
  valence       String   // 'positive' | 'negative' | 'neutral'
  dimension     String   // 'tone' | 'content' | 'understanding' | 'style'
  // Что применили (снимок axisSignals JSON для прозрачности).
  appliedSignals Json
  styleNote     String?  // короткая заметка-перевод для /axes («стал мягче»)
  // Implicit метрики (для отладки/тюнинга порогов).
  moodDelta     Float?   // valence(after) − valence(before), если mood_drop
  reaskSim      Float?   // cosine с прошлым вопросом, если re_ask
  recordedAt    DateTime @default(now())

  @@index([userId, recordedAt])
}
```
+ reverse-relation `correctionLogs CorrectionLog[]` в `model User`.

**Idempotent migration** (паттерн B1/B2): `CREATE TABLE IF NOT EXISTS`
+ `DO $$ ... FK guard ... $$` + индекс `IF NOT EXISTS`. Применяется
авто через Dockerfile `migrate deploy` (Q5/Q7 foundation).

`botExcerpt`/`userExcerpt` — снимки текста (не FK), потому что
ChatMessage имеет retention-purge (30 дней для crisis-строк) — audit не
должен ломаться при удалении исходных сообщений.

---

## 5. Components

Каталог: `src/services/feedback/` (mirror `user-axes/`, `bot-traits/`).

### 5.1 `feedback/types.ts` — типы + чистые хелперы

```ts
export type FeedbackValence = 'positive' | 'negative' | 'neutral';
export type FeedbackDimension = 'tone' | 'content' | 'understanding' | 'style';
export type FeedbackSignalType = 'explicit' | 'mood_drop' | 're_ask';

export interface ImplicitFlags {
  moodDropped: boolean;
  moodDelta: number | null;     // valence(after) − valence(before)
  isReAsk: boolean;
  reaskSim: number | null;      // max cosine с недавним вопросом
}

export interface FeedbackResult {
  isReaction: boolean;
  valence: FeedbackValence;
  dimension: FeedbackDimension;
  axisSignals: AxisSignalInput[];   // reuse B1 type
  styleNote: string | null;          // человекочитаемо для /axes
}

// --- Pure helpers (testable без DB/Claude/Voyage) ---

/** mood упал «значимо»? Порог −0.25 valence за один ход. */
export function isMoodDrop(before: number, after: number,
                           threshold = 0.25): boolean { ... }

/** Похоже ли текущее сообщение на ВОПРОС? (дешёвый гейт перед Voyage). */
export function looksLikeQuestion(text: string): boolean { ... }
//   true если: оканчивается '?', или начинается с
//   как/почему/зачем/что/когда/где/сколько/можешь/а если...

/** Дефолтный «не реакция» результат — fallback при любой ошибке. */
export const NO_REACTION: FeedbackResult = {
  isReaction: false, valence: 'neutral', dimension: 'content',
  axisSignals: [], styleNote: null,
};

/** Безопасный парсер JSON-ответа classifier'а (mirror parseAxisResponse).
 *  Любой мусор → NO_REACTION. Валидирует enum'ы, клампит дельты. */
export function parseFeedbackResponse(raw: string): FeedbackResult { ... }
```

Чистые хелперы экспортируются для unit-тестов без I/O (паттерн B1
`clampDelta`/`axisLabel`).

### 5.2 `feedback/classify-feedback.ts` — Claude haiku classifier

Mirror `user-axes/analyze-message.ts`. Best-effort, никогда не throw.

```ts
const FEEDBACK_SYSTEM_PROMPT = `Ты — анализатор РЕАКЦИЙ пользователя на
ответы ассистента LifeOS. Тебе дают (1) последний ответ бота и (2) ответ
пользователя на него. Определи, является ли сообщение пользователя
РЕАКЦИЕЙ на манеру/содержание бота, и что эта реакция говорит о личности.

ВХОД:
[БОТ]: <последняя реплика ассистента>
[ЮЗЕР]: <текущее сообщение пользователя>
[СИГНАЛЫ]: moodDropped=<bool> isReAsk=<bool>  // подсказки, не факты

ОСИ (те же 4, что в профиле личности):
- conflict_tolerance: реакция на прямоту/давление.
  «без нравоучений», «мягче», «не дави» → DOWN.
  «скажи как есть», «не сюсюкай», «будь прямее» → UP.
- introspection_depth: аппетит к рефлексии.
  «не философствуй», «давай конкретику», «по делу» → DOWN.
  «помоги понять почему», «копнём глубже» → UP.
- emotional_openness: к эмоциональному тону.
  «спасибо, поддержал», «то что нужно было услышать» → UP (слабо).
  «без эмоций», «по факту» → DOWN.
- self_discipline: обычно НЕ трогается реакцией — omit если нет явного.

DIMENSION (что именно не/зашло):
- tone: манера (жёстко/мягко/эмоционально).
- content: что посоветовал (не то / не помогло).
- understanding: бот не понял сути (особенно при isReAsk=true).
- style: прямая команда стиля («будь короче», «не философствуй»).

ПРАВИЛА:
1. Только валидный JSON. Без markdown.
2. Если это НЕ реакция на бота (просто новая тема) → isReaction=false,
   axisSignals=[]. Не выдумывай.
3. positive реакция → слабые сигналы (confidence ≤0.5): похвала
   подтверждает, но не доказывает ось так сильно, как критика.
4. negative/коррекция → сигналы сильнее (бот явно промахнулся).
5. delta [-1,1]: сильная коррекция ~0.12, средняя ~0.06, слабая ~0.02.
6. styleNote — короткая фраза-перевод для пользователя в /axes,
   напр. "ты попросил мягче — стал бережнее" или null.
7. moodDropped/isReAsk — лишь подсказки. Если текст явно нейтрален и
   позитивен, не делай негативный вывод только из флага.

ФОРМАТ:
{
  "isReaction": true,
  "valence": "negative",
  "dimension": "tone",
  "axisSignals": [
    {"axis":"conflict_tolerance","delta":-0.10,"confidence":0.8,
     "excerpt":"без нравоучений"}
  ],
  "styleNote": "ты попросил мягче — буду бережнее"
}

Если не реакция: {"isReaction": false, "valence":"neutral",
"dimension":"content", "axisSignals": [], "styleNote": null}`;

export async function classifyFeedback(
  botLastMsg: string,
  userMsg: string,
  flags: ImplicitFlags,
): Promise<FeedbackResult> {
  // build user content: [БОТ]/[ЮЗЕР]/[СИГНАЛЫ] → haiku → parseFeedbackResponse
  // any error → return NO_REACTION (never throw)
}
```

Cost: ~512 tokens out, haiku ~$0.0001/call. Только когда есть botLastMsg
и userMsg непустой. Berik ~24 msg/day → ~$0.07/mo. Negligible.

### 5.3 `feedback/detect-mood-drop.ts` — implicit сигнал #1

Reuse emotional-memory `MoodSnapshot`. Сравнивает valence текущего
сообщения с valence предыдущего хода юзера.

```ts
/** Возвращает {moodDropped, moodDelta} сравнивая 2 последних
 *  MoodSnapshot юзера. Best-effort: нет данных → {false, null}. */
export async function detectMoodDrop(userId: string,
                                     currentMsgId: string): Promise<...> {
  // SELECT 2 latest MoodSnapshot for user ordered recordedAt desc
  // before = [1].valence, after = [0].valence (current msg already analyzed
  //          by emotional-memory in same capture batch — fetch by msgId)
  // return { moodDropped: isMoodDrop(before, after), moodDelta: after-before }
}
```
NB: emotional-memory.analyzeMessage уже пишет MoodSnapshot для текущего
msg в той же capture-партии. Порядок гарантируем (§6).

### 5.4 `feedback/detect-reask.ts` — implicit сигнал #2 (Voyage)

```ts
import { embedQuery, embeddingsEnabled } from '../embeddings.js';
import { cosineSimilarity } from '../procedural-memory.js';

/** Юзер переспрашивает то же, что недавно? → прошлый ответ не зашёл.
 *  Гейт: только если looksLikeQuestion(text). Best-effort. */
export async function detectReAsk(userId: string,
                                  text: string): Promise<...> {
  if (!looksLikeQuestion(text) || !embeddingsEnabled())
    return { isReAsk: false, reaskSim: null };
  // 1. embedQuery(text)
  // 2. fetch last ~5 user ChatMessages (role='user', exclude current),
  //    last 24h, embedQuery each (or reuse stored embedding if available)
  // 3. max cosineSimilarity; isReAsk = max ≥ 0.82
  // any error → { false, null }
}
```
Стоимость Voyage: ~6 коротких embed/реакцию, оплачено, центы/мес. Гейт
`looksLikeQuestion` режет ~80% вызовов (большинство сообщений не вопросы).

### 5.5 `feedback/postgres-impl.ts` — apply + CorrectionLog

```ts
export interface FeedbackStore {
  /** Применить распознанную реакцию: записать axis-сигналы (source=
   *  'feedback', reuse B1 EWMA) + строку CorrectionLog. Best-effort. */
  applyFeedback(userId: string, msgId: string | null,
                botExcerpt: string, userExcerpt: string,
                result: FeedbackResult, signalType: FeedbackSignalType,
                flags: ImplicitFlags): Promise<void>;

  /** Последние N коррекций для /axes transparency. */
  recentCorrections(userId: string, limit?: number): Promise<Array<{...}>>;
}

export class PostgresFeedback implements FeedbackStore {
  async applyFeedback(...) {
    // 1. if result.axisSignals.length: getUserAxesStore().recordSignals(
    //      userId, msgId, result.axisSignals, 'feedback')   ← reuse B1
    // 2. prisma.correctionLog.create({ ...snapshots, appliedSignals JSON })
    // both wrapped — never throw
  }
}
```
**Ключ:** axis-запись делегируется **существующему** B1 store. B3 не
дублирует EWMA/persistence — только маршрутизирует и логирует.

### 5.6 `feedback/index.ts` — singleton

Mirror `user-axes/index.ts`: `getFeedbackStore()` lazy singleton +
re-export типов/хелперов.

---

## 6. Wiring (capture pipeline)

Точка интеграции: `v2-capture.ts`, **новая parallel-ветка** в
`Promise.allSettled` (рядом с B1 axes-веткой). Гейт `isV2FeedbackEnabled`.

**Проблема:** feedback нужен **botLastMsg** (предыдущий ответ ассистента),
которого нет в сигнатуре `captureV2InBackground(userId, text, msgId)`.

**Решение:** ветка сама достаёт его из `ChatMessage`:
```ts
// внутри feedback-ветки, до classify:
const botLast = await prisma.chatMessage.findFirst({
  where: { userId, role: 'assistant' },
  orderBy: { createdAt: 'desc' },
  select: { content: true },
});
if (!botLast) return;   // первое сообщение в истории — реагировать не на что
```

**Порядок vs mood-drop:** emotional-memory.analyzeMessage (пишет
MoodSnapshot текущего msg) и feedback-ветка обе в одном `allSettled` —
параллельны → гонка. Фикс: feedback-ветка **не зависит** от того,
записан ли MoodSnapshot текущего msg в БД — `detectMoodDrop` читает
valence текущего msg тем же дешёвым inline-вызовом, что и emotional, ИЛИ
(проще и без двойного Claude-вызова) сравнивает 2 последних *сохранённых*
снапшота, принимая 1-ход лаг. **Выбор: 1-ход лаг** — mood-drop
сравнивает предыдущий ход и позапрошлый; для коррекции тона этого
достаточно (тренд, не мгновенное значение), и мы не платим за второй
mood-анализ. (Зафиксировано как tactical decision.)

Полная ветка (псевдо):
```ts
(async () => {
  if (!isV2FeedbackEnabled(userId)) return;
  try {
    const botLast = await fetchBotLastMsg(userId);
    if (!botLast) return;
    const [moodFlags, reaskFlags] = await Promise.all([
      detectMoodDrop(userId, msgId),
      detectReAsk(userId, text),
    ]);
    const flags = { ...moodFlags, ...reaskFlags };
    const result = await classifyFeedback(botLast, text, flags);
    if (!result.isReaction) return;
    const signalType = result.dimension === 'style' || /* explicit words */
      ? 'explicit'
      : moodFlags.moodDropped ? 'mood_drop'
      : reaskFlags.isReAsk ? 're_ask' : 'explicit';
    await getFeedbackStore().applyFeedback(
      userId, msgId, botLast.slice(0,280), text.slice(0,280),
      result, signalType, flags);
  } catch (err) {
    console.warn('[v2-capture:feedback] failed:', err);
  }
})(),
```
Best-effort, никогда не ломает legacy/ответ (паттерн всей v2-capture).

---

## 7. Feature flag

`src/lib/feature-flags.ts` (mirror `isV2AxesEnabled`/`isV2IdentityEnabled`):
```ts
export function isV2FeedbackEnabled(userId: string): boolean {
  return parseFlag(process.env.FEATURE_V2_FEEDBACK, userId);
}
```
Env `FEATURE_V2_FEEDBACK`: comma-list userId / `all` / `none`(default).
Rollout: Berik (Telegram userId `cmp6n0jf90000pf017gv1kukz`) сначала.

---

## 8. Transparency — расширить `/axes`

Без новой команды (минимализм). `/axes` уже показывает оси + recentSignals.
Добавить хвост «Недавние коррекции» из `recentCorrections(userId, 5)`:
```
🔧 Недавние коррекции:
• ты попросил мягче — буду бережнее (2ч назад)
• стал меньше философствовать (вчера)
```
Источник доверия: юзер видит, что бот реально слушает реакцию. Если
коррекций нет — секция не показывается.

---

## 9. Cost & Performance

| Источник | Частота | Стоимость |
|---|---|---|
| classifyFeedback (haiku) | 1 / входящее (если есть botLast) | ~$0.07/mo @ Berik |
| detectReAsk (Voyage) | 1 / входящее-**вопрос** (~20%) | центы/mo |
| detectMoodDrop | 1 DB-read / входящее | ~0 |
| CorrectionLog write | только при isReaction (~5-15%) | ~0 |

Всё в background `allSettled` — **0 латентности** к ответу пользователю.
Гейт `isV2FeedbackEnabled` → выключено = 0 стоимости.

---

## 10. Testing Strategy (mirror B1/B2)

- **Pure helpers** (`isMoodDrop`, `looksLikeQuestion`,
  `parseFeedbackResponse`, `NO_REACTION`) — unit, без I/O. ~20 тестов.
- **classify-feedback / detect-* / postgres-impl** — структурные тесты
  через `readFileSync` + grep (проверяем: best-effort try/catch, source=
  'feedback', gate `embeddingsEnabled`, `looksLikeQuestion` гейт,
  reuse `getUserAxesStore`). Zero `vi.mock`.
- **Migration** — структурный тест скрипта через dynamic-import (паттерн
  Q6-фикса: обходит tsc rootDir).
- **Integration** (`__integration__/v2-feedback-flow.test.ts`) — grep
  что ветка в `v2-capture.ts` гейтится `isV2FeedbackEnabled`, дёргает
  `classifyFeedback` + `applyFeedback`, и что `/axes` рендерит
  `recentCorrections`.
- Базлайн: 1618 тестов сейчас зелёные. B3 добавит ~50-60.

---

## 11. Rollout Plan

1. Все таски локально, commit-per-step (discipline lock).
2. `tsc` + полный `vitest` зелёные после каждого.
3. **Explicit Berik approval** на push (precedent 2026-05-30: idём =
   один шаг; push/deploy = отдельное разрешение каждый).
4. Push → Railway `migrate deploy` авто-применит CorrectionLog миграцию.
5. Verify deploy Online + таблица в prod DB.
6. Set `FEATURE_V2_FEEDBACK=cmp6n0jf90000pf017gv1kukz` (Berik Telegram id).
7. **SMOKE в реальном Telegram**: послать боту реакцию «без нравоучений,
   мягче», затем `/axes` → увидеть коррекцию + conflict_tolerance сдвиг.
8. Aydana / `all` — позже, опционально.

---

## 12. Task Breakdown (preview — детали в плане)

| # | Task | Файлы |
|---|---|---|
| A1 | `AxisSignalSource += 'feedback'` + CorrectionLog model + idempotent migration | types.ts, schema.prisma, migration |
| B1 | `feedback/types.ts` + 4 pure helpers (isMoodDrop, looksLikeQuestion, parseFeedbackResponse, NO_REACTION) | types.ts (+test) |
| B2 | `classify-feedback.ts` haiku classifier | classify-feedback.ts (+test) |
| B3 | `detect-mood-drop.ts` | detect-mood-drop.ts (+test) |
| B4 | `detect-reask.ts` (Voyage + cosine + question gate) | detect-reask.ts (+test) |
| B5 | `postgres-impl.ts` applyFeedback + recentCorrections | postgres-impl.ts (+test) |
| B6 | `feedback/index.ts` singleton + re-exports | index.ts (+test) |
| C1 | flag `isV2FeedbackEnabled` + v2-capture feedback branch + fetchBotLastMsg | feature-flags.ts, v2-capture.ts |
| D1 | `/axes` extension — recentCorrections tail | telegram /axes handler |
| E1 | integration test + final verify + progress tracker commit | __integration__, docs |

~10 атомарных тасок. Mirror B1/B2 granularity (test→red→impl→green→tsc→commit).

---

## Self-review checklist (pre-approval)
- [x] Каждый сигнал маршрутизируется через B1 axes (нет дубль-EWMA).
- [x] Feedback НЕ трогает B2 traits напрямую (детерминизм сохранён).
- [x] Best-effort везде (never throw → legacy/reply защищены).
- [x] Feature-flagged (gradual rollout).
- [x] botLastMsg достаётся из ChatMessage (не меняем сигнатуру capture).
- [x] CorrectionLog хранит снимки текста (устойчив к retention-purge).
- [x] Стоимость negligible, 0 латентности (background).
- [x] Прозрачность через существующий /axes (минимализм).

**Awaiting Berik approval → затем writing-plans skill → subagent execution.**
