# Забывание-троица (F1/F3/F5) — дизайн

> Фиксы **F1 + F3 + F5** из диагностики памяти (`docs/diagnostics/2026-06-07-memory-quality-diagnosis.md`). Приоритет №1 «Память-качество», тема «забывание ненужного». SERVER-only (`packages/server`). Полный цикл, НЕ кодить до одобрения. **Berik одобрил дизайн.**

## Цель
Перестать топить промпт-recall в сыром чате и стале: (F1) сырые `message`-записи не лезут в семантический recall; (F3) ридер чтит `invalidAt` (фундамент будущего супер-седдинга); (F5) лёгкое пере-упоминание не выкидывает старый факт в топ.

## Подтверждено чтением живого кода + прод-данными (user Berik cmp6n0jf9…, 204 Memory)
- **F1:** `recordEvent({type:'message'})` каждый ход (`v2-capture.ts:107`); `'message'` ∈ `EMBED_DEFAULT_TYPES` (`episodic-memory.ts:122`), ∉ `TTL_DEFAULTS_DAYS` (`memory-service.ts:78`, только event:30/emotion:14), ∉ `STABLE_TYPES`. `getRelevantMemories` (`memory-service.ts:121`) **НЕ фильтрует по type**. **62/204 = 30% recall-памяти = сырой `message`.**
- **F3:** все 3 пути `getRelevantMemories` (findMany `:130-138`; hybrid `$queryRawUnsafe :149-178`; fallback `$queryRaw :185-216`) фильтруют только `expiresAt`, не `invalidAt`. **`invalidAt` стоит у 0 записей → фильтр = no-op СЕЙЧАС.**
- **F5:** `writeMemory` дедуп-update (`episodic-memory.ts:206-215`) ставит `createdAt: new Date()` (`:213`); recency-формула ридера (`:165`, `:209`) считает `exp(-age/30)` по `createdAt`.

## Решения
- **Один флаг `FEATURE_V2_FORGET` / `isV2ForgetEnabled(userId)`** (копия `isV2BirthdayEnabled`, `feature-flags.ts:66`). **off = байт-идентично.** Ship → flag=all по слову Berik.
- **Скоуп узкий:** только F1-recall-exclude + F3-invalidAt + F5-createdAt. **Отложено (опционально позже):** message TTL, стоп-эмбеддинг message, бэкфилл 62 старых message (recall-исключение уже снимает шум; рост таблицы не горит).
- Без миграции (колонки `invalidAt`/`createdAt`/`expiresAt` уже есть).

## Изменения

### F1 + F3 — ридер `getRelevantMemories` (3 пути), флаг-гейт
Вычислить один раз: `const forget = isV2ForgetEnabled(userId);`
- **findMany (no-query, `:130`):** при `forget` — добавить в `where`: `type: { not: 'message' }` И `OR:[{invalidAt:null},{invalidAt:{gt:now}}]` (через `AND:[...]`, чтобы не конфликтовать с существующим expiresAt-OR).
- **hybrid (`$queryRawUnsafe`, `:149`):** инжектить строку-клаузу `forgetSql` после `expiresAt`-WHERE: `forgetSql = forget ? \`AND m.type <> 'message' AND (m."invalidAt" IS NULL OR m."invalidAt" > NOW())\` : ''`.
- **fallback (`$queryRaw` tagged, `:185`):** конвертировать в `$queryRawUnsafe` с теми же параметрами ($1 userId, $2 query, $3 limit) + инжектить `forgetSql`. (Tagged-template нельзя безопасно интерполировать сырым SQL.)
- off → `forgetSql=''`, findMany-where без доп.условий → SQL байт-идентичен сегодняшнему.

### F5 — писатель `writeMemory` дедуп-update, флаг-гейт
`episodic-memory.ts:206-215` (`prisma.memory.update`): при `isV2ForgetEnabled(userId)` — **НЕ** класть `createdAt` в `data` (сохранить оригинал); off — `createdAt: new Date()` как сейчас. Остальное (content/details/tags/importance) без изменений.

## Поток данных
chat → writeMemory (off: createdAt сброс; on: сохраняется) → … → getRelevantMemories (off: message+invalid в recall; on: исключены) → промпт чище.

## Обработка ошибок
Без новых путей сбоя. `getRelevantMemories` — без try/catch сегодня (полагается на вызывающего best-effort); не меняем. `writeMemory` — top-level try/catch best-effort (не трогаем). Клауза-строка детерминирована (нет инъекции — `forgetSql` — литерал, не из пользовательских данных).

## Тестирование
- **it (реальная prisma):** seed user + записи: `message` + `fact`(invalidAt=now) + `fact`(активный, старый createdAt). **flag ON:** `getRelevantMemories` НЕ возвращает `message`, НЕ возвращает invalid-факт, возвращает активный; **flag OFF:** возвращает message + (invalid-факт, т.к. invalidAt игнорится) → байт-идентично сегодня. F5: записать stable-факт, пере-упомянуть (дедуп-update), ON → `createdAt` не изменился; OFF → изменился на now.
- **Структурный гард:** `getRelevantMemories` содержит `isV2ForgetEnabled` + `type <> 'message'` + `invalidAt`; `writeMemory` гейтит `createdAt` под флагом; флаг существует.
- Полный verify: `tsc --noEmit` + `vitest run` (~2707 зелёные) + integration.

## Rollout
Коммит на шаг (TDD: test→red→impl→green→tsc→commit, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`). Push/deploy/флаг — ТОЛЬКО по слову Berik; флаг сразу `all`. **Деплой-последовательность как у entity-coreference:** push (флаг off=безопасно) → verify → flag=all → verify (или сразу flag=all одним заходом — off-safe доказан тестом).
