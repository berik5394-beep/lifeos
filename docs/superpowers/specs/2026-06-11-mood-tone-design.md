# Тон-по-настроению (mood-tone) — Design Spec

> Дата: 2026-06-11. Ветка-источник: **main**. Server-only (`packages/server`).
> Контекст: кросс-домен #2, ребро «настроение ↔ всё» (interconnection_map §2: «тон коррекции — эмпатия>требовательность, приглушить нагрузку в плохой день»). Berik approved дизайн «2 части, один флаг, PRESSURE-список».

**Goal:** Плохой день/полоса (mood-сдвиг вниз) → бот (1) мягче в ответах — инструкция в промпт, перекрывает стиль; (2) не наваливает — «давящие» нуджи глушатся, поддерживающие/время-критичные/деньги-защита остаются.

**Architecture:** Один флаг `FEATURE_V2_MOOD_TONE`, off=байт-идентично. Сигнал — существующий `detectMoodShift` (нормирован на базовый уровень юзера, 3д vs 14д; уже фетчится в enrichment, 0 новых запросов в Part 1). **Part 1:** в `buildV2EnrichmentBlock` рядом с факт-строкой («настроение: 📉 сдвиг…») за флагом добавляется ИНСТРУКЦИЯ-строка. **Part 2:** в `filterCandidates` (движок проактивности) за флагом при сдвиге-вниз кандидаты из `PRESSURE_SOURCES` отбрасываются (чистый хелпер + тонкая врезка).

**Риск-принцип:** read-only (0 записей). Кризис-путь НЕ тронут (отдельный, crisis-isolation). mood_shift-нудж («поговорим?») сохраняется — он поддержка, не давление. Best-effort: сбой mood-чтения → ничего не глушим/не добавляем. Сигнал нормирован на СВОЙ базовый уровень → пессимистичный юзер не живёт в вечном «спаде».

**Tech Stack:** Fastify + Prisma6 + Postgres, ESM `.js`, TS strict no `any`, vitest, zero `vi.mock`. Коммит-на-шаг, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Текущее (проверено на main)
- `detectMoodShift(userId)` (`emotional-memory.ts:271-305`) → `{shifted, direction:'up'|'down', magnitude, sinceDays} | null` (recent 3д vs baseline 4-17д, magnitude в σ, порог 1.0). Пишется `analyzeMessage` (haiku per message) в `MoodSnapshot{valence -1..1, source:'message', recordedAt}`.
- Enrichment УЖЕ фетчит `moodShift` (`v2-enrichment.ts:354-359`) и рендерит ФАКТ (`:129-134`): `настроение: 📉 сдвиг 1.2 (3д)` — без инструкции.
- `filterCandidates(userId, candidates)` (`v2-proactivity-engine.ts:1284-1309`): gate1_DND → gate2_RateLimit → (engagement-порог) → loop gate3_Significance+gate4_Dedup. `getEmotionalMemory` уже импортирован (`:335`).
- `NudgeSource` union — 21 член (точный список в :19-41).
- Прецедент «эмпатия>стиль»: therapeutic-mode перебивает STYLE включая toxic (`jarvis-orchestrator.ts:944`) — но по-СООБЩЕНИЮ; «тяжёлая полоса» не покрыта.
- Кризис: отдельный путь (classifyCrisis → safety-шаблон, crisis=true вне LLM-контекста) — НЕ трогаем.

---

## Флаг
`feature-flags.ts` (зеркало `isV2GoalSlotEnabled`):
```ts
/**
 * Тон-по-настроению: mood-сдвиг вниз → (1) инструкция «мягче» в промпт (перекрывает
 * стиль), (2) «давящие» нуджи глушатся (PRESSURE_SOURCES). OFF → только факт-строка
 * настроения + все нуджи как раньше → байт-идентично.
 */
export function isV2MoodToneEnabled(userId: string): boolean {
  return isEnabledForUser(process.env.FEATURE_V2_MOOD_TONE, userId);
}
```

## Юнит A — Part 1: тон-директива в enrichment
`v2-enrichment.ts`, в `buildV2EnrichmentBlock` СРАЗУ после существующего факт-блока (`:129-134`), за флагом (userId должен быть доступен в форматтере — СВЕРИТЬ: если `buildV2EnrichmentBlock(data)` не имеет userId, директиву добавляет fetch-слой в data, см. примечание ниже):
```ts
if (
  isV2MoodToneEnabled(userId) &&
  data.moodShift?.shifted &&
  data.moodShift.direction === 'down'
) {
  lines.push(
    'юзер в эмоциональном спаде последние дни — будь мягче: больше поддержки, ' +
      'меньше требований и критики, не наваливай задачи и цели. ' +
      'Это перекрывает выбранный стиль (даже strict/toxic).',
  );
}
```
**ПРИМЕЧАНИЕ-сверка:** если `buildV2EnrichmentBlock(data)` — чистый форматтер БЕЗ userId (вероятно), то флаг-гейт делается в `fetchV2EnrichmentData` (там userId есть): новое поле `data.moodToneDirective: string | null` (null при off/не-down), а форматтер просто `if (data.moodToneDirective) lines.push(data.moodToneDirective)`. Это зеркалит паттерн `openLoops`. Выбрать ПО ФАКТУ сигнатуры. **off** → поле null → строка не добавляется → байт-идентично (факт-строка остаётся как была).

## Юнит B — Part 2: глушение PRESSURE-нуджей
`v2-proactivity-engine.ts`:
```ts
/** Нуджи-«давление» — глушатся в эмоциональном спаде (mood-tone, Berik-approved).
 *  Остаются: поддержка (mood_shift), время-критичное (person_meeting, commitment_due,
 *  obligation_due, birthday/memorial), деньги-защита (runway_low), decision_review,
 *  stale_entity/neglected_key_person (связь с людьми — не давление), identity_growth. */
export const PRESSURE_SOURCES: ReadonlySet<NudgeSource> = new Set([
  'goal_no_progress',
  'streak_break',
  'goal_habits_stall',
  'weekly_goal_stall',
  'monthly_goal_stall',
  'open_loop_pileup',
  'goal_impact',
  'skill_suggestion',
  'energy_link',
  'relationship_link',
]);

/** Чистый фильтр: при сдвиге-вниз убирает PRESSURE-кандидатов. Иначе — как есть. */
export function suppressPressureNudges(
  candidates: NudgeCandidate[],
  shift: { shifted: boolean; direction?: 'up' | 'down' } | null,
): NudgeCandidate[] {
  if (!shift?.shifted || shift.direction !== 'down') return candidates;
  return candidates.filter((c) => !PRESSURE_SOURCES.has(c.source));
}
```
Врезка в `filterCandidates` — после gate1/gate2-шорткатов, ПЕРЕД engagement/gate3-loop:
```ts
    if (isV2MoodToneEnabled(userId)) {
      const shift = await getEmotionalMemory()
        .detectMoodShift(userId)
        .catch(() => null);
      candidates = suppressPressureNudges(candidates, shift);
      if (candidates.length === 0) return [];
    }
```
(`candidates` — параметр; если он `readonly`/const-семантика — локальная переменная. `getEmotionalMemory` уже импортирован.) **off** → ветка не выполняется → байт-идентично.

## Обработка ошибок
- Part 1: нет I/O нового (moodShift уже в data) — только условная строка.
- Part 2: `detectMoodShift().catch(()=>null)` → null → `suppressPressureNudges` возвращает как есть (не глушим при сбое).

## Тесты
**Unit:** флаг; `suppressPressureNudges` — (а) down → pressure-кандидат (goal_no_progress) выкинут, supportive (mood_shift) и время-критичный (person_meeting) остались; (б) up/null/не-shifted → нетронуто; (в) `PRESSURE_SOURCES` НЕ содержит mood_shift/person_meeting/obligation_due/runway_low/birthday_upcoming (анти-регресс «не заглушили поддержку»). Структурный: enrichment имеет mood-tone-гейт (`isV2MoodToneEnabled` + директива/поле); движок имеет `PRESSURE_SOURCES`+`suppressPressureNudges` врезанный в `filterCandidates`.
**Integration (`mood-tone.it.test.ts`):** сидим `MoodSnapshot` напрямую (baseline 6 строк valence +0.5 в днях 5-15 назад; recent 3 строки valence −0.5 в последние 2 дня) → `getEmotionalMemory().detectMoodShift(uid)` возвращает `{shifted:true, direction:'down'}` (валидируем сигнал-путь честно); контроль: юзер без спада (ровные valence) → НЕ shifted/не-down. (filterCandidates сквозь гейты НЕ гоняем — gate1_DND зависит от текущего часа = флаки; логика глушения покрыта чистым юнитом, врезка — структурно.)

## Декомпозиция (файлы)
| Файл | Изменение |
|------|-----------|
| `src/lib/feature-flags.ts` (+test) | `isV2MoodToneEnabled` |
| `src/services/v2-enrichment.ts` | Part 1 директива за флагом |
| `src/services/v2-proactivity-engine.ts` (+unit в существующий .test или новый) | `PRESSURE_SOURCES`+`suppressPressureNudges`+врезка |
| `src/services/mood-tone-wiring.test.ts` (new) | структурный гард обеих врезок + unit suppress |
| `src/services/mood-tone.it.test.ts` (new) | сигнал-путь detectMoodShift на сидах |

## Rollout
Коммит-на-шаг (atomic TDD). Полный verify + независимое ревью (фокус: off=байт-идентично оба; read-only; кризис-путь не тронут; mood_shift/поддержка НЕ заглушены; best-effort; PRESSURE-список = ровно одобренный). `push`/`deploy`/`FEATURE_V2_MOOD_TONE=all` — ТОЛЬКО по слову Berik.

## Граница (честно)
- Part 1 — инструкция модели, не гарантия (тот же механизм, что весь STYLE).
- PRESSURE-список ручной: новые нуджи надо классифицировать (поддержка vs давление) при добавлении.
- Сигнал требует ≥3 недавних + ≥5 базовых MoodSnapshot (мало истории → null → ничего не меняется; честный скип).
- reply-тон у частых писателей живёт и без этого через therapeutic-mode (по-сообщению); этот срез добавляет ТРАЕКТОРИЮ (полоса) + глушение нагрузки.
