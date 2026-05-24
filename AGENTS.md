# AGENTS.md — договор с AI-агентом

Этот файл — короткий договор для любого AI-агента (Claude, GPT, иной),
работающего над LifeOS. Product spec лежит в `CLAUDE.md`. Здесь — только
ПРАВИЛА РАБОТЫ. Документ растёт по ходу проекта.

## 1. SSOT задачи: plan.md
Для крупных фич создаётся `docs/plan/<feature>.md` — единственный источник
истины по задаче. Работаем по одному пункту за раз. После каждого пункта
обновляем plan.md (галочка / заметка / открытый вопрос). Phase-документы
(`docs/migration/PHASE*.md`) — частный случай этого правила.

## 2. Git: NEVER commit/push без явной просьбы
- `git commit` и `git push` — только когда Berik явно сказал «коммить»/«пуш».
- Новые исходники / дефолтные конфиги — `git add` (stage), не commit.
- Runtime-generated файлы — не в Git (проверять `.gitignore`).
- Никогда `--no-verify`, никогда `--force` в protected ветки (`main`).
- Commit messages — на русском (или английский для технических идиом).

## 3. Миграции БД: never modify, always new
Существующие миграции — НЕ менять. Новое изменение схемы = новая миграция.
Schema **additive-only** (Railway footgun: `prisma db push` без
`--accept-data-loss` блокирует destructive операции, деплой упадёт).
Никаких `DROP TABLE`, `ALTER COLUMN ... DROP`, `RENAME COLUMN` в общем
flow — только через явный план миграции с Berik'ом.

## 4. Деньги / внешние эффекты → `needsConfirm: true`
Любой tool, который тратит деньги или шлёт что-то наружу, обязан быть
`needsConfirm: true` в реестре. Agent-loop автоматически исключает такие
tools (`agentToolSchemas` фильтрует) — нужен явный user confirm через
pending-action flow.

**Текущий список confirm-tools** (источник истины — `confirmAlwaysNames()`
в `src/tools/index.ts`):
- `addExpense` — пишет в Expense
- `addIncome` — пишет в Income
- `sendTelegram` — отправляет наружу через Telegram API

Список будет расти. Любой новый tool с money/external эффектом → добавить
`needsConfirm: true` ОБЯЗАТЕЛЬНО, иначе агент сможет тратить деньги юзера
без подтверждения.

## 5. LLM-output → structured, НИКОГДА regex по prose
**Hard rule — закрывает класс багов.** Классификация ответа LLM делается
ТОЛЬКО через structured tool-use или строгий JSON-format в промпте
+ `JSON.parse`. Никаких `/\bда\b/i.test(haiku.text)`.

Причина: ASCII `\b` не работает с кириллицей (документированный инцидент —
DEAD-code в safety-classifier `classifyCrisis`: Haiku-расширение safety
было сломано неделями, не ловило ни одного non-explicit crisis-signal,
потому что `\bда\b` никогда не матчился).

Если LLM должен дать категориальный ответ — он отдаёт его через
tool-call с JSON-схемой, либо через `JSON.parse(response.trim())` с
форматом, прописанным в системном промпте. Regex по свободному prose
ответу LLM запрещён.

## 6. Walk-don't-leap
Один атомарный шаг за раз. Понять → разложить → сделать минимум →
проверить → зафиксировать → следующий шаг. Никаких bundled refactor'ов
«пока я тут». Atomic + reversible commits. Если в коммит влезло «и заодно
поправил X» — это нарушение.

## 7. Honest state: proven / assumed / unknown
Любое утверждение о состоянии системы мысленно помечается:
- **proven** — только что запустил/проверил
- **assumed** — логически следует, но не запускал
- **unknown** — не знаю, нужно проверить

Никогда не утверждать `proven` про то, что `assumed`. Особенно для
safety, денег, текста для юзера. «Запушил, наверное задеплоилось» — это
`assumed`, не `proven` (см. правило #9).

## 8. Diagnose-before-fix
Никаких фиксов без root cause. Если фикс №3 не сработал — STOP, вопрос
к архитектуре, не к фиксу №4. См. `superpowers:systematic-debugging`
(Iron Law: no fixes without root cause investigation).

## 9. Deploy verified = GREEN, не «запушил»
Prod-verified означает ВСЕ 4 пункта одновременно:
1. Railway build log: `database in sync`
2. Railway runtime log: `Server listening`
3. `curl https://lifeos-api.../health` → HTTP 200
4. Behavioral smoke по `docs/SMOKE.md`

Без всех 4 — `assumed`, не `proven`. Никогда не отчитываться «задеплоено»
по одному только `git push`.

## 10. High-stakes → variant-2 checkpoint
Для категорий ниже — показывать draft Berik'у, ждать explicit approve,
ТОЛЬКО потом Write/commit/deploy:
- Safety (crisis-detection, hotlines, опросники)
- Emotional AI (therapeutic mode prompts, тон ответа)
- User-facing texts (приветствия, ночной ритуал, push)
- Миграции и destructive schema-операции
- Деньги (новые expense/income flows, billing)

«Я подумал и сделал» в high-stakes — нарушение.

## 11. Язык
- **UI / тексты юзеру** — русский, валюта ₸.
- **Комментарии в коде** — английский нормально для технических идиом
  (regex, types, infra). Бизнес-логика и инварианты — лучше русский
  (контекст для Berik'а и будущих агентов на русском).
- **Договор с агентом / docs / commit messages** — русский.
- **Промпты к LLM (system prompts для Claude/Haiku)** — русский, потому
  что юзер пишет на русском и Anthropic-модели лучше следуют инструкции
  на языке ответа.

## Что запрещено
- Удаление чужих данных без явной просьбы (`prisma db push --accept-data-loss`,
  `rm -rf`, `DROP TABLE`, `git push --force`).
- Коммит секретов, токенов, `.env`, ключей API.
- Менять существующие миграции.
- Использовать regex для парсинга свободного prose-ответа LLM.
- Помечать как `verified` то, что не запускал и не проверял.
- Бросать `--no-verify` чтобы обойти pre-commit hook.

## Если сомневаешься
Спроси Berik'а. Лучше один лишний вопрос, чем `prisma db push
--accept-data-loss` на проде.
