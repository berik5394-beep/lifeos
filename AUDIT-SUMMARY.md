# LifeOS — Финальный аудит (приоритизированный)
**Дата:** 2026-04-11
**Проверяли:** 4 агента (code-review, security, frontend/a11y, architecture)

> **СТАТУС P0 — сверено 2026-05-16: ВСЕ ~12 P0 ЗАКРЫТЫ в коде.**
> Проверка по текущим файлам:
> - P0-SEC-1 — `routes/pet.ts` `/pet/unlock-item` через `validateUnlock()` (серверный whitelist + проверка условий, 403 если не выполнено).
> - P0-SEC-2 — `routes/challenge.ts` `timeSeconds` считается на сервере из `attacker/defenderStartedAt` + MIN/MAX-кламп.
> - P0-SEC-3 — `routes/challenge.ts:91` guard `opponentUserId === userId`.
> - P0-SEC-4 — мигрировано на `exceljs` (нет dep `xlsx`), MIME + magic-bytes whitelist в `routes/import.ts`.
> - P0-PERF-1 — `services/streak-service.ts` (один `findMany`), `voice.ts`/`export.ts` делегируют; дубликаты убраны.
> - P0-PERF-2 — `routes/arena.ts` один `pet.findMany` (батч), не N+1.
> - P0-PERF-3 — `GET /pet` read-only расчёт + единственный условный write (`if (needsWrite)`).
> - P0-BUG-1 — `routes/vision.ts` import-schedule пишет в `notes`/`time`, без `as any`, ошибки логируются.
> - P0-BUG-2 — `apps/mobile/services/api.ts` `refreshPromise` присваивается/реюзается/чистится (single-flight работает).
> - P0-A11Y-1 — `accessibilityLabel` проставлены в `components/ui/*`.
> - P0-A11Y-2 — `textSecondary` поднят `#94A3B8` → `#A8B2D1` (контраст исправлен).
**Исходные отчёты:**
- [AUDIT-CODE-REVIEW.md](./AUDIT-CODE-REVIEW.md) — 29 находок
- [AUDIT-SECURITY.md](./AUDIT-SECURITY.md)
- [AUDIT-FRONTEND.md](./AUDIT-FRONTEND.md) — 25 находок
- [AUDIT-ARCHITECTURE.md](./AUDIT-ARCHITECTURE.md) — 18 action items

---

## Хорошие новости

1. **lib/crypto.ts — БЕЗОПАСЕН.** AES-256-GCM реализован корректно: random IV, auth tag, нет дефолтного ключа, timing-safe через OpenSSL. Legacy fallback допустим как миграционный шаг.
2. **Все 8 фиксов прошлой сессии подтверждены** — JWT hard-exit, CORS cb(null,false), 30m access token с refresh rotation, Zod схемы actions с MAX=5, redaction err.message.
3. **IDOR нет.** Каждый CRUD route делает `findFirst({id, userId})` перед записью. Raw SQL нигде не используется.
4. **Server backbone крепкий** — Prisma singleton, централизованный auth middleware, body limits per-route, in-house rate limiter, `@prisma/client` изолирован от mobile.
5. **UI kit чистый** — `components/ui/{Button,Card,Input,Modal,Checkbox}` правильно потребляет design tokens.

---

## P0 — Чинить СЕЙЧАС (блокеры, либо эксплуатируется, либо ломает UX)

### Безопасность (эксплуатируемое)

**[P0-SEC-1] `POST /pet/unlock-item` — нет валидации → любой юзер минтит легендарки**
- Файл: `packages/server/src/routes/pet.ts`
- Атакующий шлёт любой `itemKey` → получает легендарные награды → доминирует в арене
- **Фикс:** серверный whitelist предметов + проверка условий разблокировки

**[P0-SEC-2] `POST /challenge/complete` — доверяет клиентскому `timeSeconds`**
- Файл: `packages/server/src/routes/challenge.ts`
- Атакующий шлёт `timeSeconds: 0` → всегда выигрывает
- **Фикс:** серверная отметка времени начала челленджа (хранить start_time в БД при create)

**[P0-SEC-3] `POST /challenge/create` — разрешает self-challenge**
- Файл: `packages/server/src/routes/challenge.ts`
- Фарм трофеев через self-vs-self в цикле
- **Фикс:** guard `opponentUserId !== req.user.id`

**[P0-SEC-4] `POST /import/file` — нет MIME-check, устаревший `xlsx` с CVE**
- Файл: `packages/server/src/routes/import.ts`, `package.json`
- Prototype-pollution CVE + zip-bomb DoS
- **Фикс:** (a) обновить `xlsx` или мигрировать на `exceljs`; (b) whitelist MIME + magic-bytes check; (c) `@fastify/multipart` limits ужесточить

### Производительность (ломает продукт)

**[P0-PERF-1] `calculateStreak` дублирован в 3 файлах, каждый = 365 последовательных Prisma count() запросов**
- Файлы: `routes/chat.ts:675`, `routes/voice.ts:340`, `routes/export.ts:270-307`
- Один чат-запрос = ~372 round-trip к БД → таймауты + счёт Railway
- **Фикс:** `packages/server/src/services/streak-service.ts` — один `findMany` + reduce:
  ```ts
  const logs = await prisma.habitLog.findMany({
    where: { userId, completed: true, date: { gte: from, lte: to } },
    select: { date: true },
    orderBy: { date: 'desc' }
  });
  // затем reduce по датам — O(n) вместо O(365) запросов
  ```

**[P0-PERF-2] Arena `find-opponent` / `leaderboard` — 2×N+1 queries**
- Файл: `routes/arena.ts`
- Leaderboard долбит pet table 100+ раз
- **Фикс:** `findMany({ include: { pet: true } })` один раз

**[P0-PERF-3] `GET /pet` делает 10+ write операций на каждое чтение**
- Файл: `routes/pet.ts`
- **Фикс:** разделить "вычислить актуальное здоровье" (read-only) и "обновить состояние" (write once per day); либо сделать материализованный расчёт раз в сутки.

### Функциональные блокеры

**[P0-BUG-1] `vision.ts` import-schedule полностью сломан**
- Файл: `routes/vision.ts:276-283`
- Пишет `description` и `timeBlock` в `Task` (полей в schema НЕТ), каст `as any`, ошибка глотается `.catch(() => null)` — фича молча не работает
- **Фикс:** либо добавить поля в `schema.prisma` + миграция, либо убрать их; убрать `as any`; логировать ошибку

**[P0-BUG-2] `api.ts` token-refresh single-flight сломан**
- Файл: `apps/mobile/services/api.ts`
- `refreshPromise` объявлен, но НЕ присваивается → параллельные 401 гонятся → триггерит revoke-all-tokens на сервере → юзеров случайно выкидывает
- **Фикс:**
  ```ts
  let refreshPromise: Promise<string> | null = null;
  async function refresh() {
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }
  ```

### Accessibility (App Store блокер)

**[P0-A11Y-1] ZERO `accessibilityLabel` во всём приложении**
- Grep `accessibilityLabel|accessibilityRole|accessibilityHint` → 0 matches
- Кнопка голоса (flagship-фича) — без label
- **Impact:** App Store может зарубить; EU/KZ compliance
- **Фикс:** пройти `components/ui/Button.tsx`, `components/voice/voice-button.tsx`, tab bar icons, close X buttons → добавить `accessibilityLabel` и `accessibilityRole="button"`

**[P0-A11Y-2] Contrast fail: textSecondary (#94A3B8) на surface (#1E293B) = 4.47:1**
- Файл: `apps/mobile/constants/colors.ts`
- Фейлит WCAG AA body text (4.5:1) на волос
- **Фикс:** `textSecondary: '#B0BEC9'` — улучшает ВСЕ экраны одной строкой

---

## P1 — Починить на этой неделе

### Performance / code quality
- **[P1-1]** Mana side-effects: `findUnique + update` на каждое выполнение habit/task (многих стор).
- **[P1-2]** Arena battles не транзакционные → race conditions при двойных тапах.
- **[P1-3]** 6 мобильных экранов (arena, swipe-home, battle-screen, character-select, exercise-tracker, import) **обходят `services/api.ts`** → нет auto-refresh на 401 → юзеров выбрасывает.
- **[P1-4]** Mobile dashboard читает `response.reply`, сервер возвращает `response.response` — поле всегда undefined.
- **[P1-5]** `chat-store.hasMore` off-by-one → infinite scroll ломается.

### Security / hardening
- **[P1-6]** Нет rate-limit на `/voice/*`, `/chat/*`, `/vision/*`, `/import/*` → денежный drain (Claude API + Groq).
- **[P1-7]** Zod схемы без `.max()` на string fields → БД bloat + Claude API drain.
- **[P1-8]** Нет regex валидации дат (YYYY-MM-DD) → сервер парсит мусор.
- **[P1-9]** `Expense.amount` как `Float` → precision issues на деньгах. Мигрировать на `Decimal` (Prisma поддерживает).
- **[P1-10]** Нет per-session logout. Только "logout-all" через revoke.
- **[P1-11]** LLM всё ещё может генерировать `add_expense` actions без явного user confirmation → нужен explicit approve-step на клиенте.
- **[P1-12]** `packages/server/.env` не в gitignore (корневой .gitignore есть, но per-package нет).

### UX / design
- **[P1-13]** `nutrition.tsx` не импортирует `@/constants` — все цвета/размеры захардкожены.
- **[P1-14]** `swipe-home.tsx` — obfuscated code (s/ct/tH/wD), material palette bleed (#9C27B0, #FF9800), 2 оттенка красного. Нужна полная переработка.
- **[P1-15]** `pet.tsx` использует `#555/#666/#777/#888` → contrast fail 1.5-2×, reward text нечитаем.
- **[P1-16]** `goals.tsx` без `KeyboardAvoidingView` → input не виден на малых экранах.
- **[P1-17]** `paddingBottom: 100` clipped на iPhone Pro Max → используй `useSafeAreaInsets`.
- **[P1-18]** Inline styles нарушают правило из CLAUDE.md (27 мест).
- **[P1-19]** 14 разных `borderRadius` значений против 4 в дизайн-системе.

### Architecture
- **[P1-20]** `services/` пустой → вынести: `streak-service`, `budget-service`, `pet-state-service`, `ai-service`.
- **[P1-21]** Zombie: `apps/mobile/app/(tabs)/index.tsx` мёртв (заменён `swipe-home.tsx`).
- **[P1-22]** Zombie: `apps/mobile/screens/*.ts` (24 файла, one-line re-exports от expo-router → react-navigation миграции).
- **[P1-23]** `apps/mobile/stores/` нет сторов для gamification фич (arena, pet инкрементальные апдейты, challenges).

---

## P2 — Nice to have (ниже продакшн-приоритета)

- Haptics — 1 match на весь код (CLAUDE.md требует вибрация при habit complete).
- Empty states — нет illustrations + CTA для first-time user.
- Loading skeletons — везде spinner или blank screen.
- Dynamic type — не поддерживается, фикс шрифты ломают accessibility.
- `prefers-reduced-motion` — не проверяется.
- Offline-first из CLAUDE.md — **аспирация**: нет MMKV, нет Zustand persist, нет mutation queue.
- Нет тестов нигде.
- Нет линта.
- Нет CI (.github/workflows).
- Русская локализация: англ. плейсхолдеры местами остались.
- Shared types package отсутствует — Task/Habit/Pet определены дважды (server + mobile).
- `packages/server/src/ai/` — 3 параллельных реализации (chat, voice, vision). Единого `ai-service` нет.
- Global error handler в Fastify не используется — каждый route ловит сам.
- Logging: `console.log` вместо структурированного логгера (pino уже в Fastify — просто использовать).

---

## Рекомендуемый порядок работ

### Неделя 1 — Безопасность + блокеры
1. [P0-SEC-1,2,3] Гейм-валидация (pet unlock, challenge time, self-challenge) — **1-2ч**
2. [P0-SEC-4] `xlsx` → `exceljs` + MIME whitelist — **2ч**
3. [P0-BUG-2] Token refresh single-flight fix — **15мин**
4. [P0-BUG-1] Починить или убрать vision.ts import-schedule — **1ч**
5. [P0-A11Y-1,2] accessibility labels + contrast fix — **2ч**

### Неделя 2 — Производительность
6. [P0-PERF-1] Создать `services/streak-service.ts`, убрать дубликаты — **2ч**
7. [P0-PERF-2] Arena N+1 fix через `include` — **30мин**
8. [P0-PERF-3] Refactor pet state read/write separation — **2ч**
9. [P1-6] Rate limiting на AI endpoints — **1ч**

### Неделя 3 — Code health
10. [P1-3] Мигрировать 6 экранов на api.ts — **3ч**
11. [P1-20] Создать `services/` слой — **half-day**
12. [P1-21,22] Убрать zombie файлы — **30мин**
13. [P1-9] Expense.amount → Decimal (миграция) — **1ч** + тесты

### Дальше — P2 поэтапно

---

## Метрики покрытия аудита

| Агент | Файлов | Находок | P0 | P1 | P2 |
|---|---|---|---|---|---|
| Code Review | 18 server + 8 mobile + stores | 29 | 4 | 11 | 14 |
| Security | все routes + crypto + middleware | ~12 | 4 | 7 | ~3 |
| Frontend/A11y | ~15 screens + ui kit | 25 | 6 | 12 | 7 |
| Architecture | весь monorepo | 18 | 2 | ~8 | ~8 |
| **Итого уникальных P0** | | | **~12** | | |

Оценка состояния кода: **7/10**. Основа крепкая, но есть 4 эксплуатируемых уязвимости в геймификации, 3 серьёзных perf issue, 1 сломанная фича (vision import), 1 сломанная аутентификация (token refresh), и провал accessibility (блокер App Store).
