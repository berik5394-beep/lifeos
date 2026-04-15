# LifeOS — Статус проекта и документация
**Дата обновления:** 7 апреля 2026

---

## Стек технологий
- **Mobile:** React Native + Expo SDK 54 + TypeScript (Expo Go на iPhone)
- **Backend:** Fastify + Prisma ORM + PostgreSQL (Railway)
- **AI:** Claude API (tool_use + web search), Groq Whisper (voice)
- **State:** Zustand stores
- **Auth:** JWT access/refresh tokens
- **Навигация:** 7-page swipe layout (PanResponder) в swipe-home.tsx

---

## Структура проекта
```
/Users/berikkurmangoliev/Desktop/LifeOS/
├── apps/mobile/
│   ├── app/(tabs)/chat.tsx          — Чат с ИИ
│   ├── app/(tabs)/tasks.tsx         — Задачи (CRUD)
│   ├── app/swipe-home.tsx           — Главный экран со свайпами
│   ├── services/api.ts              — API клиент с auto-refresh
│   ├── hooks/use-voice.ts           — Голосовой ввод
│   ├── components/voice/voice-button.tsx — Кнопка микрофона (Siri-стиль)
│   ├── navigation/index.tsx         — Навигация + auto refreshAuth
│   └── app.json                     — Конфиг Expo (permissions)
├── packages/server/
│   ├── src/routes/chat.ts           — Чат API + web search (Claude tool_use)
│   ├── src/routes/voice.ts          — Транскрипция (Groq Whisper)
│   ├── src/routes/auth.ts           — JWT auth (7d access, 30d refresh)
│   ├── src/ai/assistant-personality.ts — Системный промпт ИИ
│   └── .env                         — Ключи API
```

---

## Что было сделано и исправлено (7 апреля 2026)

### 1. Исправлена ошибка "Произошла ошибка" во всех API вызовах
**Корень проблемы:** JWT accessToken истекал через 15 минут, механизм auto-refresh отсутствовал.
**Решение:**
- Полностью переписан `apps/mobile/services/api.ts`
- Добавлена функция `tryRefreshToken()` — при 401 ошибке автоматически обновляет токен через `/auth/refresh`
- Повторяет запрос с новым токеном
- Токены: accessToken = 7 дней, refreshToken = 30 дней
- В `navigation/index.tsx` добавлен `refreshAuth()` при старте приложения

### 2. Исправлено смешивание тем в чате
**Корень проблемы:** Сервер отправлял 30 предыдущих сообщений как историю в Claude API, из-за чего ответы смешивались.
**Решение:**
- В `packages/server/src/routes/chat.ts` теперь отправляется ТОЛЬКО текущее сообщение пользователя, без истории
- `max_tokens` увеличен с 512 до 1024
- В `assistant-personality.ts` добавлено строгое правило: "ЗАПРЕЩЕНО смешивать ответ с предыдущими темами"

### 3. Добавлен веб-поиск для ИИ
**Решение:**
- В `chat.ts` добавлена функция `webSearch()` через DuckDuckGo HTML scraping (cheerio)
- Claude tool_use: инструмент `web_search` — ИИ сам решает когда искать
- Цикл: Claude вызывает web_search → сервер ищет → возвращает tool_result → Claude формирует ответ

### 4. Исправлена загрузка персонажа (свайп влево)
**Корень проблемы:** `useEffect(() => {...}, [])` — пустой dependency array, данные загружались до получения токена.
**Решение:**
- В `swipe-home.tsx` добавлен `token` в dependency array
- Добавлен guard `if (!token) return;`

### 5. Добавлено редактирование и удаление задач
**Решение:**
- В `tasks.tsx` добавлен edit modal (title, category, priority, time)
- TaskItem теперь принимает `onEdit` prop
- Кнопка удаления внутри edit modal
- hitSlop увеличен до 12px

### 6. Исправлен голосовой ввод
**Решение:**
- `use-voice.ts` и `chat.tsx` переписаны: вместо raw `fetch` используется `api.post` (с auto-refresh)
- В `voice-button.tsx` добавлена анимация кольца (как Siri)
- Иконка: `mic` → `square` при записи
- В `app.json` добавлены разрешения iOS/Android для микрофона
- В `voice.ts` (сервер) добавлена проверка размера аудио и try/catch для Groq

### 7. Новый Groq API ключ
- Старый ключ `gsk_...zlFu` был невалидным (401 Invalid API Key)
- Создан новый ключ `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` на console.groq.com
- Обновлён в `.env`, сервер перезапущен

---

## Текущие API ключи (.env)
- **CLAUDE_API_KEY:** sk-ant-api03-... (работает)
- **GROQ_API_KEY:** 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 (новый, 7 апреля)
- **Пароль пользователя:** test123 (был сброшен при отладке)

---

## Сервер
- Адрес: `http://172.20.10.4:3000` (через iPhone hotspot)
- Запуск: `cd packages/server && npx tsx src/index.ts`
- Metro: `cd apps/mobile && npx expo start --clear`

---

## Известные ограничения / TODO на будущее
1. **Голосовая активация приложения** — требует native build (не Expo Go)
2. **Редактирование/удаление** в других вкладках (habits, goals, finance) — аналогично tasks.tsx
3. **Expo tunnel** — ngrok нестабилен, работает через локальную сеть iPhone hotspot
4. **История чата** — сейчас отключена для Claude, можно добавить умную фильтрацию по теме
5. **Голосовой ввод** — проверить работу с новым Groq ключом

---

## Архитектурные решения
- **api.ts** — центральный HTTP клиент с interceptor для auto-refresh токенов
- **Zustand** — все stores (auth, tasks, habits, chat, pet, etc.)
- **Claude tool_use** — расширяемая система инструментов (web_search первый, можно добавлять)
- **DuckDuckGo scraping** — бесплатный веб-поиск без API ключей
- **7-page swipe** — PanResponder в swipe-home.tsx для навигации

---

## Сессия 10 апреля 2026 — Vision API, Счётчик углеводов, План уроков

### Что сделано

**1. Backend — Vision API (Claude Sonnet 4)**
- `packages/server/src/routes/vision.ts` — 5 эндпоинтов:
  - `POST /vision/analyze-food` — принимает `imageBase64`, возвращает `{foodName, portion, calories, carbs, protein, fat, confidence, notes}`
  - `POST /vision/save-food` — сохраняет блюдо в `NutritionLog`
  - `GET /vision/food/today` — итоги за сегодня + список блюд
  - `POST /vision/analyze-schedule` — OCR расписания уроков, возвращает `{title, items: [{day, time, subject, room, teacher, notes}]}`
  - `POST /vision/import-schedule` — создаёт Task'и с category='study' из распознанных уроков
- Модель: `claude-sonnet-4-20250514` с Vision
- Хелпер `extractJSON()` для парсинга ответов Claude (обрабатывает code fences)

**2. Prisma schema — NutritionLog**
- Добавлена модель `NutritionLog` (userId, date, foodName, portion, calories, carbs, protein, fat, confidence, imageUrl, notes)
- Индекс `@@index([userId, date])`
- Связь с User: `nutritionLogs NutritionLog[]`
- `npx prisma db push` → база Railway синхронизирована

**3. packages/server/src/index.ts**
- Добавлен `import { visionRoutes } from './routes/vision.js'`
- `await app.register(visionRoutes)` после `challengeRoutes`

**4. Mobile — экран nutrition.tsx (счётчик углеводов)**
- `apps/mobile/app/nutrition.tsx` — полный экран:
  - SafeAreaView + заголовок с back
  - Карточка «Сегодня» — ккал/углеводы/белки/жиры
  - Превью фото + индикатор распознавания
  - Карточка результата с макросами, уверенностью, кнопкой «Добавить в дневник»
  - Лента сегодняшних блюд
  - Footer: кнопка «Камера» + «Галерея»
- Использует `expo-image-picker` (установлен ранее), `base64: true`
- Запросы: `GET /vision/food/today`, `POST /vision/analyze-food`, `POST /vision/save-food`
- Re-export: `screens/nutrition.ts`

**5. Mobile — экран schedule-import.tsx (план уроков)**
- `apps/mobile/app/schedule-import.tsx`:
  - Камера/галерея → Claude Vision OCR
  - Список распознанных уроков с днём, временем, кабинетом, учителем
  - Кнопка «Добавить всё в задачи» → `POST /vision/import-schedule`
- Re-export: `screens/schedule-import.ts`

**6. Навигация**
- `navigation/types.ts`: добавлены `Nutrition: undefined` и `ScheduleImport: undefined`
- `navigation/index.tsx`: импорты и `<RootStack.Screen>` для обоих экранов (headerShown: false)

**7. Точки входа**
- `apps/mobile/app/settings/index.tsx`:
  - Добавлены `handleNutrition` и `handleScheduleImport`
  - Новая секция «AI-инструменты» с двумя пунктами:
    - 🍽️ Счётчик углеводов (камера)
    - 📸 План уроков (сфотографировать)

**8. Permissions — app.json**
- iOS `infoPlist`:
  - `NSCameraUsageDescription` — «LifeOS использует камеру для счётчика калорий и сканирования расписания уроков»
  - `NSPhotoLibraryUsageDescription` — «LifeOS использует фото для распознавания еды и расписаний»
- Android `permissions`: добавлены `CAMERA` и `READ_EXTERNAL_STORAGE`
- Плагин `expo-image-picker` с русскими `cameraPermission` и `photosPermission`

**9. Сервер перезапущен**
- Убит старый процесс на :3000, запущен новый `nohup npx tsx src/index.ts`
- Слушает `http://127.0.0.1:3000` и `http://172.20.10.4:3000`
- Проверки: `/health` → 200, `/vision/food/today` → 401 (роут есть), `/voice/transcribe` → 401 (роут есть)
- Логи чистые

### Что проверить на устройстве завтра

1. **Перезапустить Expo** с `npx expo start --clear` (а лучше `npx expo prebuild` т.к. добавились новые native permissions для камеры)
2. **Микрофон** — Groq ключ обновлён ранее, guard от коротких записей стоит. Нажать микрофон → сказать что-то длиннее секунды → должен распознать
3. **Счётчик углеводов** — Настройки → AI-инструменты → 🍽️ Счётчик углеводов → кнопка «Камера» → сфотографировать еду → должен распознать и показать макросы
4. **План уроков** — Настройки → AI-инструменты → 📸 План уроков → сфотографировать расписание → должен распознать уроки → «Добавить всё в задачи»

### Известные моменты

- Для **production iOS build** нужен `expo prebuild` или новая EAS-сборка, т.к. добавлены NSCameraUsageDescription и plugin expo-image-picker
- **Lesson plan import** создаёт Task'и на текущую неделю по дням недели (логика внутри `/vision/import-schedule`)
- Если фото плохого качества — `confidence < 0.6` отображается ниже, пользователь может переснять
- `NutritionLog.imageUrl` пока не используется (не сохраняем фото на сервер), можно добавить потом через S3/Railway volume

### Файлы, изменённые в эту сессию

```
packages/server/src/index.ts                    (+2 строки — import и register visionRoutes)
packages/server/src/routes/vision.ts            (без изменений, создан в прошлой сессии)
packages/server/prisma/schema.prisma            (+21 строка — NutritionLog + связь в User)
apps/mobile/app/nutrition.tsx                   (NEW, 337 строк)
apps/mobile/app/schedule-import.tsx             (NEW, 280 строк)
apps/mobile/screens/nutrition.ts                (NEW, re-export)
apps/mobile/screens/schedule-import.ts          (NEW, re-export)
apps/mobile/navigation/types.ts                 (+2 строки)
apps/mobile/navigation/index.tsx                (+4 строки — импорты и screens)
apps/mobile/app/settings/index.tsx              (+16 строк — handlers и секция AI)
apps/mobile/app.json                            (+camera permissions, +expo-image-picker plugin)
```
