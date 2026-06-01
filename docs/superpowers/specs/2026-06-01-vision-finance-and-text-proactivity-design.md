# Vision-Finance + Larger Text + Inline Proactivity — Design Spec

**Status:** DRAFT → awaiting Berik review
**Author:** Claude (subagent-driven), brainstormed with Berik 2026-06-01
**Quality bar:** «Умный Джарвис» — no халтура. YAGNI.

## 1. Context & Motivation
LifeOS = AI-друг с памятью (RN+Expo мобайл + Fastify/Prisma бэкенд; голос/чат). Berik просит расширить «руки и восприятие» друга:
1. **Деньги по фото** — сфоткать чек/скрин банка/перевода, ИИ читает и предлагает запись (расход при списании, доход при поступлении). Удобно в ресторане.
2. **Больше текста** — ИИ должен переваривать длинный рассказ (сейчас обрезается ~4000 симв).
3. **Проактивность из текста** — из длинного рассказа вытащить скрытое намерение и **в том же ответе** мягко предложить оформить («…давай пригласим её — поставить в задачу?»).

**Решения с Berik (2026-06-01):**
- ✅ **Серверный мозг сейчас** (A-сервер + C + D), тест через Telegram (бот уже принимает фото). Мобильная камера-UX (A-mobile + ресайз 4K) — при сборке приложения, тот же эндпоинт.
- ✅ **Деньги по фото = одно-тап подтверждение** (не авто-запись): ИИ читает → показывает готовую запись → юзер подтверждает ✅ / правит ✏️. Сохраняет money-инвариант (никаких автономных денег) + защита от ошибок OCR.
- ✅ **Проактивность из текста = inline** (в том же ответе), подсказка с подтверждением (не авто-создание).

### Non-Goals
- ❌ Мобильная камера/ресайз (B) — отдельно, при сборке приложения. Telegram сам сжимает фото → тест не блокируется.
- ❌ Авто-запись денег без подтверждения. ❌ Чанкинг гигантских текстов (YAGNI; 16k символов покрывает «рассказ»).
- ❌ Отдельный отложенный nudge для D (только inline сейчас).
- ❌ Робот-аватар / редизайн UI — слой представления, вне этой спеки.

---

## 2. Sub-project A — Finance-by-photo (server)

### 2.1 `services/finance-vision.ts`
- `analyzeFinancePhoto(imageBase64, mediaType): Promise<FinanceVisionResult>` — Claude vision (sonnet vision; vision нужен реальный, не haiku-text). Промпт: «На фото чек / скрин банковского уведомления / перевода. Определи: направление (СПИСАНИЕ→expense, ПОСТУПЛЕНИЕ→income), сумму в тенге (число), категорию, продавца/источник, дату. Верни ТОЛЬКО JSON.»
- `parseFinanceResponse(text): FinanceVisionResult` — **чистый** defensive-парсер (extractJSON + валидация): `{ direction: 'expense'|'income'|'unknown', amount: number|null, category?: string, merchant?: string, date?: string (YYYY-MM-DD), confidence: number }`. Кривой JSON / нет суммы → `direction:'unknown', amount:null` (никогда не выдумываем). Unit-тестируется без сети.

### 2.2 Route `POST /vision/analyze-finance`
- В `routes/vision.ts`, рядом с analyze-schedule. preHandler: auth + photo bodyLimit (15MB) + `aiDailyLimiter` + validate.
- Тело: `{ image, mediaType }`. Ответ: `FinanceVisionResult` + готовый человекочитаемый текст подтверждения.

### 2.3 Confirm-flow (money-safe, переиспользуем PendingAction)
- direction∈{expense,income} И amount>0 → собрать `PendingAction`:
  - expense → action `add_expense`, input `{ amount, category, description: merchant }`
  - income → action `add_income`, input `{ amount, source: merchant }`
  - confirmationText: «Записать **расход 3000 ₸ · Magnum · еда**? ✅ да / ✏️ исправь».
- На «да» → `runConfirmedAction` → существующий `add_expense`/`add_income` (money-safe). На правку — юзер пишет текстом (обычный путь).
- `unknown` / низкая confidence / amount=null → бот честно: «Не разобрал сумму на фото — напиши вручную?». Не создаёт PendingAction.

### 2.4 Канал сейчас — Telegram
- `telegram-bot.ts` `bot.on('photo')`: скачать фото (getFileLink уже есть) → base64 → `analyzeFinancePhoto` → если финансовое (direction≠unknown, amount>0) → confirm-сообщение (тот же PendingAction-механизм). **НЕ перехватываем существующие фото-потоки:** финанс-ветка срабатывает только когда analyze уверенно вернул финансовое (или по caption-хинту «чек/расход/трата»); иначе фото идёт прежним путём. Полноценный image-type-router (расписание vs чек vs задача) — позже.
- Мобайл (позже): кнопка камеры в финансах → тот же `/vision/analyze-finance` → confirm-UI.

---

## 3. Sub-project C — Larger text window
- Поднять обрезку пользовательского текста с `4000` до **`MAX_USER_TEXT = 16000`** в горячем пути: места `userText.slice(0, 4000)` (orchestrator persist) и вход в извлечение (capture/extractFromTranscript). Вынести в именованную константу (SSOT).
- ⚠️ Стоимость: больше входных токенов. Ограничено дневным AI-лимитом (2.3). Чанкинг гигантских — позже.

---

## 4. Sub-project D — Inline proactivity from text
- За фиче-флагом `isV2InlineNudgeEnabled` (env-форма как у сиблингов).
- Блок в систем-промпте оркестратора (`jarvis-prompt.ts`): «Если сообщение — длинный рассказ И в нём есть скрытое НАМЕРЕНИЕ/возможность (свидание, звонок, дело, цель) — в КОНЦЕ ответа мягко предложи оформить: ОДНО предложение, вопросом, легко проигнорировать. Не настаивай, не более одного предложения за ответ.» Примеры в промпте (девушка→пригласить, идея→цель).
- На «да» от юзера — уже существующие `create_task` / `suggest_goal` (через подтверждение). Никакого нового инструмента.
- Флаг off → байт-в-байт текущее поведение.

---

## 5. Safety / Cost / Degradation
- **Money-инвариант цел:** всё через PendingAction confirm; vision только ЧИТАЕТ и ПРЕДЛАГАЕТ.
- **OCR-устойчивость:** amount должен быть положительным числом; иначе unknown → переспрос.
- **Degrade-safe:** флаг D off / vision сбой → сегодняшнее поведение. analyzeFinancePhoto best-effort (не роняет).
- **Стоимость:** A (+1 vision-вызов на фото), C (больше токенов), D (чуть длиннее промпт) — растят per-message $, ограничено дневным лимитом (2.3).

---

## 6. Testing
- **A:** `parseFinanceResponse` — pure unit (expense/income/unknown/кривой JSON/без суммы). Structural: route зарегистрирован, Telegram photo→finance ветка, confirm через PendingAction → add_expense/add_income.
- **C:** structural — константа `MAX_USER_TEXT = 16000` используется вместо хардкода 4000 в горячем пути.
- **D:** structural — промпт-блок присутствует за флагом `isV2InlineNudgeEnabled`; флаг в feature-flags.
- Базовая сюита (~1843) зелёная. Zero vi.mock.

---

## 7. Rollout (explicit Berik approval per step)
1. Tasks локально, commit-per-step, tsc+vitest зелёные.
2. Push (на «пуш»). 3. Deploy. 4. Флаг(и) `=user-{berik}`.
5. **SMOKE (по факту БД):** отправить боту фото чека → confirm «да» → проверить, что Expense-строка появилась (НЕ нарратив). Длинный текст → inline-предложение. Длинный рассказ обрабатывается без обрезки.

---

## Self-review checklist
- [x] Только согласованный объём (A-сервер, C, D); B/редизайн/image-router — Non-Goals.
- [x] Money-safe (confirm, не авто). [x] Degrade-safe + флаги. [x] Pure parser + structural тесты, zero vi.mock.
- [x] Канал сейчас Telegram (testable), мобайл — потом, тот же эндпоинт.

**Awaiting Berik review → writing-plans.**
