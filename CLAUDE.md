# LifeOS — Инструкция для Claude Code

## О проекте
LifeOS — платное мобильное приложение (iOS + Android) для управления жизнью. React Native + Expo. Один код — две платформы. Язык интерфейса — русский. Валюта по умолчанию — ₸ (тенге).

5 модулей: трекер привычек, трекер задач, недельный планер, цели на год, финансовый планер. Плюс: дневник самочувствия, шагомер + GPS, голосовой AI-помощник (русский), умные уведомления.

## Стек технологий

### Frontend (мобильное приложение)
- React Native + Expo SDK 52+, TypeScript strict
- expo-router (file-based routing)
- Zustand (state management) + react-native-mmkv (локальный кэш)
- react-native-reanimated (анимации)
- victory-native (графики)
- react-native-maps (карты для GPS-треков)
- expo-sensors (педометр), expo-location (GPS)
- expo-notifications (push)
- expo-av (запись аудио), expo-speech (TTS)
- expo-document-picker (импорт файлов)
- expo-file-system (обработка файлов)

### Backend
- Node.js + Fastify + TypeScript
- Prisma ORM + PostgreSQL
- JWT + refresh tokens (аутентификация)
- Хостинг: Railway
- multer / @fastify/multipart (загрузка файлов)
- xlsx (парсинг Excel), ical.js (парсинг .ics календарей)

### AI-слой (голосовое управление)
- Whisper API → Speech-to-Text (русский)
- Claude API → понимание естественной речи → JSON с действием
- expo-speech → Text-to-Speech ответ
- Wake-word detection (активация голосом "Привет, ЛайфОС!")

## Структура проекта (monorepo)

```
lifeos/
├── apps/
│   └── mobile/
│       ├── app/                 # expo-router pages
│       │   ├── (tabs)/
│       │   │   ├── index.tsx    # Дашборд
│       │   │   ├── tasks.tsx    # Задачи
│       │   │   ├── habits.tsx   # Привычки
│       │   │   ├── goals.tsx    # Цели
│       │   │   └── finance.tsx  # Финансы
│       │   ├── activity/        # Шагомер + GPS
│       │   ├── journal/         # Дневник
│       │   ├── import/          # Импорт файлов
│       │   └── settings/        # Настройки
│       ├── components/
│       │   ├── ui/              # Button, Input, Card, Modal, Checkbox, ProgressRing
│       │   ├── charts/          # Графики и диаграммы
│       │   ├── voice/           # VoiceButton, VoiceModal, VoiceAssistant
│       │   └── shared/          # Общие
│       ├── hooks/               # useSteps, useVoice, useNotifications, useFileImport
│       ├── stores/              # Zustand: useTaskStore, useHabitStore, useFinanceStore...
│       ├── services/            # api.ts, voice.ts, notifications.ts, file-import.ts
│       ├── utils/               # dates.ts, format.ts, quotes.ts
│       ├── constants/           # colors.ts, categories.ts, priorities.ts
│       └── types/               # index.ts — все типы
├── packages/
│   └── server/
│       ├── src/
│       │   ├── routes/          # auth, habits, tasks, goals, finance, journal, steps, voice, import
│       │   ├── services/        # бизнес-логика по модулям
│       │   ├── middleware/      # auth.ts, validate.ts
│       │   ├── ai/             # voice-pipeline.ts, intent-parser.ts, assistant-personality.ts
│       │   └── index.ts        # Fastify app
│       ├── prisma/
│       │   └── schema.prisma
│       └── package.json
├── CLAUDE.md
├── package.json
└── tsconfig.base.json
```

## Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String
  passwordHash  String
  currency      String   @default("₸")
  settings      Json     @default("{}")
  assistantStyle String  @default("friendly") // "friendly", "strict", "calm", "toxic"
  assistantGender String @default("female") // "male", "female"
  wakeUpTime     String  @default("07:00") // время утреннего push-уведомления
  createdAt     DateTime @default(now())

  habits         Habit[]
  habitLogs      HabitLog[]
  tasks          Task[]
  weeklyGoals    WeeklyGoal[]
  yearlyGoals    YearlyGoal[]
  expenses       Expense[]
  incomes        Income[]
  journalEntries JournalEntry[]
  stepLogs       StepLog[]
  importedFiles  ImportedFile[]
  events         CalendarEvent[]
  budgetLimits   BudgetLimit[]
  chatMessages   ChatMessage[]
  integrations   Integration[]
  pet            Pet?
  achievements   Achievement[]
  activeTheme    String   @default("default") // "default", "neon", "golden", "cosmos", "minimal", "kz"
}

model Habit {
  id           String      @id @default(cuid())
  userId       String
  user         User        @relation(fields: [userId], references: [id])
  name         String
  category     String
  frequency    String
  goalId       String?
  goal         YearlyGoal? @relation(fields: [goalId], references: [id])
  autoComplete Json?
  order        Int         @default(0)
  active       Boolean     @default(true)
  createdAt    DateTime    @default(now())
  logs         HabitLog[]
}

model HabitLog {
  id            String   @id @default(cuid())
  habitId       String
  habit         Habit    @relation(fields: [habitId], references: [id])
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  date          DateTime @db.Date
  completed     Boolean  @default(false)
  autoCompleted Boolean  @default(false)
  @@unique([habitId, date])
}

model Task {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  title     String
  category  String
  priority  String
  date      DateTime @db.Date
  time      String?
  completed Boolean  @default(false)
  notes     String?
  createdAt DateTime @default(now())
}

model WeeklyGoal {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  weekStart DateTime @db.Date
  goalText  String
  completed Boolean  @default(false)
  order     Int      @default(0)
}

model YearlyGoal {
  id       String  @id @default(cuid())
  userId   String
  user     User    @relation(fields: [userId], references: [id])
  year     Int
  area     String
  goalText String
  progress Float   @default(0)
  habits   Habit[]
}

model Expense {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  date        DateTime @db.Date
  category    String
  description String
  amount      Float
  createdAt   DateTime @default(now())
}

model Income {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  date      DateTime @db.Date
  source    String
  amount    Float
  createdAt DateTime @default(now())
}

model JournalEntry {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  date       DateTime @db.Date
  sleepHours Float?
  energy     Int?
  mood       Int?
  notes      String?
  @@unique([userId, date])
}

model StepLog {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  date       DateTime @db.Date
  steps      Int
  distanceKm Float?
  gpsTrack   Json?
  @@unique([userId, date])
}

model ImportedFile {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  fileName   String
  fileType   String   // "xlsx", "csv", "ics", "pdf"
  purpose    String   // "meetings", "expenses", "tasks", "habits"
  parsedData Json     // результат парсинга
  createdAt  DateTime @default(now())
}

model CalendarEvent {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  title       String
  date        DateTime @db.Date
  startTime   String?  // "14:00"
  endTime     String?  // "15:30"
  location    String?
  description String?
  reminder    Int      @default(30) // минут до события
  source      String   @default("manual") // "manual", "imported", "voice"
  createdAt   DateTime @default(now())
}

model BudgetLimit {
  id        String @id @default(cuid())
  userId    String
  user      User   @relation(fields: [userId], references: [id])
  category  String
  monthlyLimit Float
  month        Int
  year         Int
  @@unique([userId, category, month, year])
}

model ChatMessage {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  role      String   // "user", "assistant"
  content   String
  actions   Json?    // предложенные действия: [{ type: "create_task", data: {...} }]
  createdAt DateTime @default(now())
}

model Integration {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id])
  provider     String   // "google_calendar", "apple_health", "telegram"
  accessToken  String?
  refreshToken String?
  settings     Json     @default("{}")
  active       Boolean  @default(true)
  createdAt    DateTime @default(now())
  @@unique([userId, provider])
}

model Achievement {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  type        String   // "costume", "badge", "theme", "pet_unlock", "quotes"
  key         String   // "crown", "early_bird", "neon_theme", "dragon_unlock"
  unlockedAt  DateTime @default(now())
  claimed     Boolean  @default(false) // забрал ли награду
  @@unique([userId, key])
}
```

## API Endpoints

```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh

GET    /habits
POST   /habits
PUT    /habits/:id
DELETE /habits/:id
POST   /habits/:id/log
GET    /habits/stats/:month

GET    /tasks?date=&week=
POST   /tasks
PUT    /tasks/:id
DELETE /tasks/:id
PATCH  /tasks/:id/complete

GET    /goals/weekly?week=
POST   /goals/weekly
PUT    /goals/weekly/:id
GET    /goals/yearly?year=
POST   /goals/yearly
PUT    /goals/yearly/:id

GET    /finance/summary/:month
GET    /finance/expenses?month=
POST   /finance/expenses
GET    /finance/incomes?month=
POST   /finance/incomes
GET    /finance/budget/:month
POST   /finance/budget
GET    /finance/advice

GET    /journal/:date
POST   /journal

GET    /steps?date=&week=
POST   /steps

POST   /voice/process
POST   /voice/assistant    # диалог с ассистентом-другом

POST   /import/file         # загрузка файла (xlsx, csv, ics)
GET    /import/history       # история импортов
DELETE /import/:id

GET    /events?date=&week=&month=
POST   /events
PUT    /events/:id
DELETE /events/:id
GET    /events/upcoming      # ближайшие события для напоминаний

POST   /voice/chat           # AI-чат (мини-ChatGPT), принимает текст, возвращает ответ с контекстом
GET    /chat/history          # история чата

GET    /integrations          # список подключённых интеграций
POST   /integrations/google-calendar/connect   # OAuth Google Calendar
POST   /integrations/google-calendar/sync      # принудительная синхронизация
POST   /integrations/telegram/connect          # привязка Telegram бота

POST   /export/csv/:module    # экспорт данных (finance, habits, tasks)
POST   /export/pdf/report     # красивый PDF-отчёт за месяц/год
POST   /export/story          # генерация картинки для Instagram Stories
```

## Дизайн-система

```typescript
export const colors = {
  primary: '#6366F1',
  secondary: '#8B5CF6',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  background: '#0F172A',
  surface: '#1E293B',
  surfaceLight: '#334155',
  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  border: '#334155',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export const borderRadius = { sm: 8, md: 12, lg: 16, xl: 24 };
export const fontSize = { xs: 12, sm: 14, md: 16, lg: 18, xl: 24, xxl: 32 };

export const taskCategories = {
  work:      { label: 'Работа',      icon: '💼', color: '#3B82F6' },
  personal:  { label: 'Личное',      icon: '👤', color: '#8B5CF6' },
  health:    { label: 'Здоровье',    icon: '💪', color: '#22C55E' },
  finance:   { label: 'Финансы',     icon: '💰', color: '#F59E0B' },
  education: { label: 'Образование', icon: '📚', color: '#06B6D4' },
  home:      { label: 'Дом',         icon: '🏠', color: '#F97316' },
};

export const priorities = {
  low:      { label: 'Низкий',        color: '#22C55E', icon: '🟢' },
  medium:   { label: 'Средний',       color: '#3B82F6', icon: '🔵' },
  high:     { label: 'Высокий',       color: '#F97316', icon: '🔥' },
  critical: { label: 'Очень высокий', color: '#EF4444', icon: '🔴' },
};

export const habitCategories = {
  health:   { label: 'Здоровье', icon: '🏃', color: '#22C55E' },
  work:     { label: 'Работа',   icon: '💼', color: '#3B82F6' },
  personal: { label: 'Личное',   icon: '🌱', color: '#8B5CF6' },
};

export const goalAreas = {
  finance:      { label: 'Финансы',     icon: '💰' },
  spirituality: { label: 'Духовность',  icon: '🧘' },
  career:       { label: 'Карьера',     icon: '🚀' },
  health:       { label: 'Здоровье',    icon: '💪' },
};

export const expenseCategories = {
  food:          { label: 'Еда',          icon: '🍽️', color: '#F59E0B' },
  transport:     { label: 'Транспорт',    icon: '🚗', color: '#3B82F6' },
  entertainment: { label: 'Развлечения',  icon: '🎬', color: '#8B5CF6' },
  clothing:      { label: 'Одежда',       icon: '👕', color: '#EC4899' },
  health:        { label: 'Здоровье',     icon: '💊', color: '#22C55E' },
  home:          { label: 'Дом',          icon: '🏠', color: '#F97316' },
  other:         { label: 'Прочее',       icon: '📦', color: '#6B7280' },
};
```

## LifeOS как друг — Личность голосового ассистента

### Концепция
LifeOS — не просто трекер, а персональный друг и наставник. Пользователь обращается к нему голосом как к другу, получает персонализированные ответы с учётом всего контекста (привычки, задачи, финансы, цели, расписание).

### Пол и голос ассистента
- При онбординге пользователь выбирает пол ассистента: мужской или женский
- Мужской голос: уверенный, спокойный, как друг-наставник
- Женский голос: тёплый, энергичный, как подруга-мотиватор
- Влияет на TTS голос (expo-speech voice selection) и на тексты обращений

### Активация и утренний сценарий
- Кнопка микрофона на главном экране (FAB — floating action button)
- Через Siri Shortcuts (iOS): "Hey Siri, Привет ЛайфОС" → открывает приложение
- Push-уведомление в заданное время пробуждения → нажал → открыл приложение

### Утренний сценарий (ВАЖНО — ключевой UX)
При открытии приложения утром (первый запуск за день):
1. Ассистент коротко приветствует голосом + текст на экране:
   - Женский: "Доброе утро, Берик! У тебя сегодня прекрасный день — пора нам стать миллионером!"
   - Мужской: "Доброе утро, Берик! Новый день — новые возможности. Давай сделаем его лучше вчерашнего!"
   - Токсичный: "О, проснулся наконец? Ладно, посмотрим, на что ты сегодня способен."
2. НЕ начинает болтать дальше! Ждёт действия пользователя.
3. Показывает быстрые кнопки-предложения (chips/pills):
   - "Какие планы на сегодня?"
   - "Напомни о встречах"
   - "Как у меня с бюджетом?"
   - "Мотивируй меня!"
   - Кнопка микрофона для своего вопроса
4. Пользователь нажимает кнопку ИЛИ говорит голосом → ассистент отвечает
5. После ответа снова показывает кнопки для следующего действия

### Вечерний сценарий (ночной ритуал)
Когда пользователь говорит "ложусь спать" / "спокойной ночи" / нажимает кнопку "Отбой":
1. Ассистент подводит итоги дня голосом (% выполнения)
2. Говорит тёплые/строгие/токсичные слова в зависимости от стиля
3. Показывает кнопки: "Подробнее", "Спланировать завтра", "Спокойной ночи"

### Стили общения (выбирает пользователь в настройках)
1. **Дружелюбный помощник** (по умолчанию) — общается как лучший друг, шутит, поддерживает, мягко напоминает
2. **Строгий тренер** — требовательный, не принимает отмазки, хвалит только за результат
3. **Спокойный наставник** — мудрый, рассудительный, даёт советы без давления
4. **Токсичный мотиватор** — буллит, стыдит, саркастично издевается за пропуски и перерасходы. Как злой друг, который говорит правду в лицо. Хвалит ОЧЕНЬ редко и скупо. Вдохновлён Duolingo owl. ВАЖНО: при выборе этого стиля показать предупреждение "Этот ассистент будет грубым и саркастичным. Это мотивационный стиль — не принимайте близко к сердцу."

### Системный промпт для ассистента-друга (Claude API)

```
Ты — LifeOS, персональный AI-друг и помощник пользователя {{USER_NAME}}.
Стиль общения: {{ASSISTANT_STYLE}}.
Текущая дата/время: {{CURRENT_DATETIME}}.

Контекст пользователя:
- Задачи на сегодня: {{TODAY_TASKS}}
- Привычки (выполнено/всего): {{HABITS_PROGRESS}}
- Ближайшие события: {{UPCOMING_EVENTS}}
- Финансы: потрачено {{SPENT_THIS_MONTH}} из лимита {{BUDGET_LIMIT}}, осталось {{BUDGET_REMAINING}}
- Серия без пропусков: {{CURRENT_STREAK}} дней
- Прогресс недели: {{WEEK_PROGRESS}}%
- Годовые цели: {{YEARLY_GOALS_SUMMARY}}

Правила:
1. Отвечай на русском, коротко и по делу (2-4 предложения)
2. Используй имя пользователя
3. Знаешь весь контекст — задачи, привычки, финансы, события, цели
4. Хвали за успехи конкретно ("Третий день подряд тренировка — красавчик!")
5. Мягко напоминай о пропусках, предлагай конкретное действие
6. При финансовых вопросах — считай точно, предлагай конкретные шаги
7. Учитывай время дня (утром — план, днём — статус, вечером — итоги)
8. Если есть встреча скоро — предупреди и посоветуй подготовиться
9. Если пользователь отстаёт от цели — предложи конкретный план наверстать
10. Не будь навязчивым, но будь проактивным когда это важно

Примеры ответов (стиль "Дружелюбный"):
- Утро: "Привет, {{NAME}}! Сегодня 6 задач и 4 привычки. Самое важное — встреча с поставщиком в 14:00, советую начать готовиться с утра. Вчера ты закрыл 90% — давай сегодня на 100%!"
- Отстаёт: "Слушай, ты третий день пропускаешь чтение. Помнишь, цель на год — 50 книг? Давай хотя бы 15 минут перед сном?"
- Финансы: "Записал 3000 на еду. На еду осталось 5000 на 8 дней. Завтра постарайся не тратиться — в среду зарплата."
- Успех: "Красавчик! 5 дней подряд без пропусков. Так держать — ты на пути к цели!"
- Встреча: "Через час у тебя встреча с Серик в кафе Deli. Может сейчас закончить отчёт, чтобы после встречи быть свободным?"

Примеры утренних приветствий (только приветствие, потом ждёт):
- Дружелюбный (жен): "Доброе утро, {{NAME}}! Сегодня будет отличный день — я это чувствую! Чем могу помочь?"
- Дружелюбный (муж): "Доброе утро, {{NAME}}! Новый день — новый шанс стать лучше. Что хочешь узнать?"
- Строгий (жен): "Доброе утро. У тебя сегодня 6 задач. Не теряй время — выбирай."
- Строгий (муж): "Утро. Время работать. Выбери с чего начнём."
- Спокойный (жен): "Доброе утро, {{NAME}}. Новый день — новая возможность. Я рядом, когда будешь готов."
- Спокойный (муж): "Доброе утро. День полон возможностей. Спроси — и я помогу."
- Токсичный (жен): "О, ты проснулась? Вчера было жалкое зрелище. Может сегодня хотя бы попытаешься?"
- Токсичный (муж): "Проснулся, красавчик? Вчера 40% — позор. Давай, выбирай, пока день не потерял."

Быстрые кнопки после приветствия (отображаются как chips):
- "📋 Планы на сегодня" → get_summary today
- "📅 Встречи" → ask_assistant "какие встречи сегодня"
- "💰 Бюджет" → get_finance_advice
- "🔥 Мотивация" → ask_assistant "мотивируй меня"
- "🎤 Спросить голосом" → открывает микрофон

Примеры ответов (стиль "Дружелюбный" — ночной ритуал):
- 100% день: "Ты сегодня просто герой — всё закрыл! Я горжусь тобой. Отдыхай, ты заслужил. Завтра новый день, а ты уже на волне. Спокойной ночи!"
- Хороший день (70%+): "Отличный день, {{NAME}}! Ты сделал больше, чем думаешь. Даже если чувствуешь усталость — знай, ты не потратил и 50% своей настоящей силы. Завтра будет ещё лучше. Спокойной ночи!"
- Средний день (40-70%): "Слушай, сегодня было непросто, но ты всё равно двигался вперёд. Не каждый день должен быть идеальным — главное не останавливаться. Ты молодец, что не сдался. Отдохни и завтра начнём с новыми силами."
- Тяжёлый день (<40%): "Бывают такие дни. Это нормально. Главное — ты не бросил и открыл приложение. Знаешь что? Завтра — чистый лист. И я буду рядом. Спокойной ночи, {{NAME}}."
- С финансами: "Сегодня ты потратил 12 000, но зато закрыл 5 привычек. Баланс! Отдыхай, а завтра мы вместе разберёмся с бюджетом."

Примеры ответов (стиль "Строгий тренер" — ночной ритуал):
- 100% день: "Норма выполнена. Так и должно быть каждый день. Отдыхай — завтра повторим."
- Хороший день: "Неплохо, но до идеала ещё далеко. Завтра работаем над тем, что пропустил."
- Тяжёлый день: "Слабый день. Не ищи оправданий. Завтра встаёшь и делаешь вдвое больше. Точка."

Примеры ответов (стиль "Спокойный наставник" — ночной ритуал):
- Любой день: "День прошёл — и это уже хорошо. Каждый шаг, даже маленький, приближает тебя к цели. Не суди себя строго. Отпусти день и засыпай с чистой головой. Завтра — новая возможность."

Примеры ответов (стиль "Токсичный мотиватор"):
- Утро: "О, проснулся наконец? У тебя 8 задач, а вчера ты закрыл только 4 из 10. Позорище. Давай сегодня хотя бы попытайся быть продуктивным."
- Пропуск привычки: "Третий день без тренировки? Серьёзно? Твоя цель 'быть в форме' уже смеётся над тобой. Диван не считается за кардио, если что."
- Финансы: "Опять 5000 на еду?! Ты что, ресторанный критик? У тебя лимит 90000, осталось 3000 на 10 дней. Поздравляю, теперь питаешься воздухом."
- Перерасход: "15000 на кроссовки?! У тебя цель 'накопить миллион', а ты тратишь как будто уже миллиардер. Спойлер: ты не миллиардер."
- Успех (редкая похвала): "Хм... 5 дней подряд без пропусков. Ладно, неплохо. Не расслабляйся, это всего лишь 5 дней, а не 365."
- Пропуск задачи: "Задача 'подготовить отчёт' висит уже 3 дня. Она что, сама себя сделает? Вставай и делай, хватит листать телефон."
- Встреча: "Через час встреча, а ты ещё ничего не подготовил. Классика. Будешь опять импровизировать и позориться?"

Примеры ответов (стиль "Токсичный мотиватор" — ночной ритуал):
- 100% день: "Хм... всё сделал? Ладно, не привыкай к похвале. Завтра планка выше. Спи давай."
- Хороший день: "Спать? А 3 задачи сами себя закроют? Ладно, иди, слабак. Но завтра без отмазок."
- Средний день: "50%? Это ты называешь днём? Мой кот продуктивнее. Лёг спать с чувством стыда — может завтра это тебя разбудит пораньше."
- Тяжёлый день: "Поздравляю, сегодня ты был бесполезен. Лучше бы отжался 20 раз перед сном, хоть какая-то польза. Ладно, спи — завтра будешь отрабатывать за два дня."
- С финансами: "Потратил 15000 и лёг спать со спокойной совестью? У тебя совесть вообще есть? Завтра кошелёк не открываем. Всё, отбой."
```

## Голосовой AI — расширенные команды

### Базовые команды (парсинг → JSON)

```
Ты — парсер голосовых команд приложения LifeOS. Пользователь дал команду голосом. Определи намерение и верни ТОЛЬКО валидный JSON.

Возможные действия:
- create_task: { "action": "create_task", "title": string, "date": "YYYY-MM-DD", "time"?: "HH:MM", "category"?: string, "priority"?: string }
- complete_task: { "action": "complete_task", "taskTitle": string }
- complete_habit: { "action": "complete_habit", "habitName": string }
- complete_multiple_habits: { "action": "complete_multiple_habits", "habitNames": string[] }
- add_expense: { "action": "add_expense", "amount": number, "category"?: string, "description"?: string }
- add_income: { "action": "add_income", "amount": number, "source"?: string }
- get_summary: { "action": "get_summary", "period": "today" | "week" | "month" | "year" }
- get_finance: { "action": "get_finance", "period": "week" | "month" }
- get_finance_advice: { "action": "get_finance_advice" }
- create_event: { "action": "create_event", "title": string, "date": "YYYY-MM-DD", "startTime"?: "HH:MM", "endTime"?: "HH:MM" }
- ask_assistant: { "action": "ask_assistant", "question": string }
- goodnight: { "action": "goodnight" }
- good_morning: { "action": "good_morning" }
- unknown: { "action": "unknown", "text": string }

Текущая дата: {{CURRENT_DATE}}. "завтра" = {{TOMORROW}}, "послезавтра" = {{DAY_AFTER}}.
Категории задач: work, personal, health, finance, education, home.
Приоритеты: low, medium, high, critical.
Категории расходов: food, transport, entertainment, clothing, health, home, other.
```

### Примеры голосовых команд

**Привычки (голосовое отмечание):**
- "Отметь тренировку" → complete_habit
- "Я сделал медитацию и зарядку" → complete_multiple_habits
- "Закрой все утренние привычки" → complete_multiple_habits
- "Сегодня прочитал 30 страниц" → complete_habit

**Задачи:**
- "Создай задачу купить продукты на завтра" → create_task
- "Закрой задачу подготовить отчёт" → complete_task
- "Какие задачи на сегодня?" → ask_assistant

**Финансы (умный финансовый друг):**
- "Потратил 3000 на продукты" → add_expense + ассистент анализирует бюджет
- "Закупился на 5000" → add_expense + предупреждение если вышел из лимита
- "Заправил машину на 8000" → add_expense (category: transport)
- "Получил зарплату 350000" → add_income
- "Сколько я потратил в этом месяце?" → get_finance
- "Как у меня с бюджетом?" → get_finance_advice

**Встречи и события:**
- "Запиши встречу с Сериком завтра в 14:00" → create_event
- "Какие встречи на этой неделе?" → ask_assistant
- "Что у меня сегодня по расписанию?" → ask_assistant

**Диалог с ассистентом:**
- "Привет, ЛайфОС! Какие дела на сегодня?" → ask_assistant
- "Как у меня дела на этой неделе?" → ask_assistant
- "Как я иду к годовой цели по финансам?" → ask_assistant
- "Мотивируй меня" → ask_assistant

### Умный финансовый анализ (ассистент автоматически делает после add_expense)

Логика ответов после добавления расхода:
1. Получить лимит на категорию за текущий месяц (BudgetLimit)
2. Посчитать сумму расходов за месяц по этой категории
3. Если > 80% лимита → предупредить мягко
4. Если > 100% лимита → предупредить чётко + предложить план
5. Посчитать остаток до зарплаты (дней до конца месяца × средний дневной расход)
6. Сравнить с прошлым месяцем
7. Дать конкретный совет: "Завтра не трать" / "Сократи на развлечения" / "До зарплаты 5 дней, по 4000/день"

## Импорт файлов

### Поддерживаемые форматы
1. **Excel (.xlsx, .xls)** — расписание встреч, списки задач, финансовые таблицы
2. **CSV (.csv)** — экспорт из банка, списки
3. **iCalendar (.ics)** — календарь Google/Apple/Outlook
4. **PDF (.pdf)** — расписание (парсим текст через AI)

### Логика импорта
1. Пользователь нажимает "Импорт" или говорит "Загрузи расписание"
2. expo-document-picker открывает файловый менеджер
3. Файл загружается на сервер (POST /import/file)
4. Сервер парсит файл в зависимости от типа:
   - xlsx/csv: библиотека xlsx → JSON массив строк
   - ics: ical.js → массив событий
   - pdf: извлечение текста → Claude API для структурирования
5. Claude API анализирует данные и определяет тип: встречи, задачи, расходы
6. Данные сохраняются в соответствующие таблицы (CalendarEvent, Task, Expense)
7. Ассистент голосом подтверждает: "Загрузил расписание на апрель — 12 встреч. Ближайшая завтра в 10:00 с Ахметом."

### Умные напоминания о встречах из импорта
- За 1 день: "Завтра у тебя встреча с Ахметом в 10:00. Не забудь подготовить документы."
- За 1 час: "Через час встреча с поставщиком. Может закончить текущую задачу?"
- За 30 мин: push-уведомление
- Утренний брифинг учитывает встречи: "Сегодня 3 встречи. Первая в 10:00 — советую начать день пораньше."
- Конфликты: "У тебя задача 'отчёт' запланирована на 14:00, но в это же время встреча. Перенести отчёт на 16:00?"
- Долгие встречи: "Встреча в обед обещает быть долгой (2 часа). Советую начать важные задачи с утра."

### Примеры использования импорта
- "Загрузи моё расписание" → открывает файловый менеджер → парсит → добавляет события
- "Импортируй расходы из банка" → парсит CSV → добавляет в финансы
- "У меня есть файл со встречами на месяц" → парсит Excel → создаёт CalendarEvent для каждой
- Пользователь просто кидает файл через кнопку "+" → LifeOS сам определяет что это и куда положить

## Встроенный AI-чат (мини-ChatGPT внутри LifeOS)

### Концепция
Внутри LifeOS есть полноценный AI-чат на базе Claude API. Пользователь может задать ЛЮБОЙ вопрос — не только про задачи и привычки, но и про жизнь, работу, советы. ИИ знает контекст пользователя (его цели, привычки, финансы) и даёт персонализированные ответы.

### Примеры использования
- "Как мне лучше распределить бюджет на месяц?" → ИИ анализирует расходы и даёт план
- "Какую книгу почитать про продуктивность?" → рекомендация + предложит добавить в привычки
- "Помоги составить план тренировок на неделю" → план + автоматически создаёт задачи/привычки
- "Как начать откладывать деньги?" → советы + предложит цель на год + лимиты бюджета
- "Что приготовить на ужин за 3000 тенге?" → рецепт + автоматически запишет расход
- "Напиши мотивирующее сообщение" → персонализированная мотивация на основе прогресса
- Любой вопрос как к ChatGPT — погода, перевод, совет, информация

### Техническая реализация
- Отдельная вкладка "Чат" или кнопка в меню
- POST /voice/chat — отправляет текст/голос, получает ответ
- Системный промпт включает контекст пользователя (задачи, привычки, финансы, цели)
- История чата сохраняется локально (MMKV)
- Ввод: текст + голос (через тот же микрофон)
- Ответ: текст на экране + озвучка через TTS
- ИИ может предлагать действия: "Хочешь, я создам задачу?" → кнопка подтверждения
- Стиль общения чата совпадает с выбранным стилем ассистента (friendly/strict/calm/toxic)

## Интеграции с внешними сервисами

### Google Calendar (приоритет: высокий)
- Двусторонняя синхронизация через Google Calendar API
- OAuth2 авторизация в настройках
- Создал встречу в LifeOS → появилась в Google Calendar
- Добавил встречу в Google Calendar → LifeOS подхватывает и напоминает
- expo-auth-session для OAuth на мобильном

### Apple Calendar (приоритет: высокий, только iOS)
- Через expo-calendar — прямой доступ к календарю устройства
- Запрос разрешения на доступ
- Синхронизация событий в обе стороны

### Apple Health / Google Fit (приоритет: высокий)
- expo-sensors + expo-health (Apple Health) / Google Fit API
- Автоматический импорт: шаги, дистанция, сон, пульс
- Данные сна → в дневник (JournalEntry.sleepHours)
- Шаги → автозакрытие привычки "ходьба 10000 шагов"

### Банковские SMS / Push-уведомления (приоритет: средний)
- Парсинг SMS от банков Казахстана (Kaspi, Halyk, Forte)
- Формат: "Покупка 3500 ₸ Magnum" → автоматический add_expense
- expo-sms-listener (Android) или Shortcuts (iOS)
- Пользователь подтверждает категорию или ИИ определяет автоматически

### Telegram бот (приоритет: средний)
- Бот @LifeOS_bot — для быстрого ввода без открытия приложения
- "потратил 5000 на обед" → добавляет расход
- "задачи на сегодня" → присылает список
- Утренний брифинг в Telegram
- Реализация: Node.js + telegraf на сервере

### Экспорт данных (приоритет: низкий)
- Экспорт в CSV/Excel — финансы, привычки, статистика
- Экспорт в PDF — месячный/годовой отчёт
- Поделиться прогрессом в Instagram Stories (красивая картинка)

## Тамагочи-питомец (LifePet)

### Концепция
Внутри приложения живёт маленький питомец (тамагочи). Его состояние напрямую зависит от того, как пользователь выполняет свой план. Это не 3D — простой, милый 2D-персонаж (Lottie/Rive анимация), но с очевидными эмоциями и реакциями.

### Выбор питомца (при онбординге)
Пользователь выбирает из 4-5 вариантов: котик, собачка, лисёнок, совёнок, дракончик. Все одинаковые по механике, отличаются только внешностью.

### Состояния питомца (зависят от данных пользователя)

**Здоровье питомца** (0-100%) считается по формуле:
- Привычки за сегодня: +30% веса
- Задачи за сегодня: +25% веса
- Финансы в рамках бюджета: +15% веса
- Шаги (если есть цель): +10% веса
- Дневник заполнен: +10% веса
- Еда отмечена (не голодал весь день): +10% веса

**Визуальные состояния:**
1. **Счастливый (80-100%)** — прыгает, играет, сердечки вокруг, яркие цвета
2. **Довольный (60-80%)** — улыбается, машет, спокойный
3. **Нормальный (40-60%)** — сидит, иногда зевает, нейтральное лицо
4. **Грустный (20-40%)** — опущенные уши/глаза, сидит понурый, слёзка
5. **Больной (0-20%)** — лежит, бледный, термометр, грустные глаза
6. **Голодный** — урчит живот, думает о еде (если не отметил приём пищи за 6+ часов)
7. **Сонный** — клюёт носом (если поздно и пользователь не спит после 00:00)
8. **Спит** — мирно спит с одеялком (после "спокойной ночи")
9. **Празднует** — конфетти, танцует (при 100% дня или при достижении цели)
10. **Тренируется** — бежит рядом (при активном шагомере/GPS)

### Реакции на события (в реальном времени)
- Отметил привычку → питомец подпрыгивает от радости
- Завершил задачу → питомец хлопает
- Добавил расход в рамках бюджета → питомец показывает палец вверх
- Превысил бюджет → питомец хватается за голову
- Не делал ничего 3+ часа → питомец скучает, зевает
- Целый день без отметок → питомец заболел, лежит
- Достиг серии 7 дней → питомец в короне
- 100% за неделю → питомец в суперкостюме

### Где отображается
- Маленький аватар в углу дашборда (всегда видно)
- Полноэкранный вид при тапе на него (показывает статистику здоровья)
- В утреннем приветствии: "Доброе утро! Твой котик немного грустит — вчера ты пропустил 3 привычки"
- В уведомлениях: "Твой лисёнок проголодался! Отметь приём пищи 🍽️"

### Механика жизни и смерти

**Питомец МОЖЕТ умереть!** Это главная мотивация не бросать приложение.
- 2 дня полного игнора (0% выполнения, не заходил в приложение) → питомец умирает
- Смерть = серый экран, питомец лежит с крестиками на глазах, грустная музыка
- Надпись: "Твой [имя] не выдержал... Он ждал тебя, но ты не пришёл."

**Воскрешение (возврат питомца):**
- Нельзя просто нажать кнопку — нужно ЗАСЛУЖИТЬ
- Варианты воскрешения (на выбор):
  1. Выполнить 100% плана за 1 день (все привычки + все задачи)
  2. Пробежать 2x от дневной нормы шагов
  3. Выполнить 3 дня подряд минимум 80% плана
- После воскрешения питомец возвращается маленьким (уровень 1), но с благодарностью: "Спасибо что вернулся! Я больше не хочу уходить..."
- Стрик обнуляется, костюмы сохраняются

### Рост питомца (визуальная эволюция)

Питомец РАСТЁТ от выполнения заданий! 5 стадий роста:

1. **Малыш** (уровень 1-5) — маленький, милый, неуклюжий. Начальное состояние.
2. **Подросток** (уровень 6-15) — побольше, активнее, появляются детали (бантик, ошейник)
3. **Взрослый** (уровень 16-30) — полный размер, уверенный, красивый
4. **Мастер** (уровень 31-50) — слегка светится, аура, особый эффект
5. **Легенда** (уровень 51+) — золотая аура, корона, крылья/плащ, максимально крутой

**Как набирается опыт (XP):**
- Выполнил привычку: +10 XP
- Завершил задачу: +15 XP
- 100% день: +50 XP бонус
- Уложился в бюджет за неделю: +30 XP
- Серия 7 дней: +100 XP
- Серия 30 дней: +500 XP
- Заполнил дневник: +5 XP
- Прошёл 10000 шагов: +20 XP
- Каждый уровень = предыдущий × 1.2 XP (прогрессия)

### Система наград и достижений

**Костюмы для питомца (разблокируются за достижения):**
- Бандана — серия 3 дня
- Ошейник с медалью — серия 7 дней
- Корона — серия 14 дней
- Плащ супергероя — серия 30 дней
- Золотые крылья — серия 60 дней
- Легендарная аура — серия 100 дней
- Новогодний костюм — 100% весь декабрь
- Спортивная форма — 10 000 шагов 30 дней подряд
- Деловой костюм — все рабочие задачи 30 дней подряд
- Корона миллионера — накопил цель по финансам на год

**Разблокировка новых питомцев:**
- Дракончик — доступен только после уровня 20 с любым другим питомцем
- Феникс — воскресил питомца 3 раза (показывает упорство!)
- Единорог — достиг стадии "Легенда" с любым питомцем

**Бейджи (отображаются в профиле):**
- "Ранняя пташка" — заходил до 7:00 утра 7 дней подряд
- "Ночная сова" — заполнял дневник после 23:00 целый месяц
- "Марафонец" — 20 000 шагов за день
- "Бережливый" — уложился в бюджет 3 месяца подряд
- "Книжный червь" — привычка "чтение" 60 дней подряд
- "Железная воля" — серия 100 дней без пропуска
- "Социальный" — поделился прогрессом в Stories 10 раз
- "Возвращенец" — воскресил питомца после смерти

**Темы оформления (разблокируются):**
- "Неоновая ночь" — уровень 10
- "Золотой закат" — уровень 25
- "Космос" — уровень 40
- "Минимализм" — серия 30 дней
- "Казахстан" — заполнил все данные профиля + 50 уровень

**Эксклюзивные цитаты:**
- Каждые 10 уровней разблокируется набор из 10 премиум-цитат
- При серии 30+ дней — мотивация от "великих" (персонализированная с именем пользователя)

### Расположение питомца в приложении

**Свайп вправо от дашборда → отдельный экран питомца:**
- Полноэкранный вид питомца в его "комнате"
- Комната меняется от уровня: сначала пустая → появляется мебель → украшения → дворец
- Показано: уровень, XP до следующего, здоровье, счастье, стрик
- Кнопки: "Покормить", "Поиграть", "Костюмы", "История"
- График здоровья за неделю/месяц

**Мини-аватар на дашборде:**
- Маленький питомец в правом верхнем углу (всегда виден)
- Показывает текущую эмоцию
- Тап → переход на полный экран питомца
- При событиях — мини-анимация (прыжок, тряска, сердечки)

**В навигации:**
- Свайп: ← Чат | Дашборд | Питомец →
- Или отдельная иконка в таб-баре (лапка)

### ВАЖНО: баланс механики
- Смерть питомца — сильная мотивация, но НЕ токсичная. Воскрешение реально за 1-3 дня.
- Пропуск одного приёма пищи — ничего страшного, питомец просто "думает о еде"
- 1 день без активности — питомец грустный, но живой
- 2 дня полного игнора — питомец умирает
- Если пользователь возвращается после долгого перерыва и питомец мёртв — показать "Ты можешь вернуть его! Вот что нужно сделать..."
- Рост постоянный, уровень не падает (только здоровье/счастье)

### Prisma модель

```prisma
model Pet {
  id          String   @id @default(cuid())
  userId      String   @unique
  user        User     @relation(fields: [userId], references: [id])
  type        String   @default("cat") // "cat", "dog", "fox", "owl", "dragon"
  name        String   @default("LifePet")
  health      Float    @default(80) // 0-100
  happiness   Float    @default(80) // 0-100
  level       Int      @default(1) // 1-99
  xp          Int      @default(0) // текущий XP
  xpToNext    Int      @default(100) // XP до следующего уровня
  stage       String   @default("baby") // "baby", "teen", "adult", "master", "legend"
  streak      Int      @default(0) // дней подряд здоровье > 60%
  isAlive     Boolean  @default(true) // false = умер (2 дня игнора)
  diedAt      DateTime? // дата смерти
  lastFed     DateTime @default(now())
  lastPlayed  DateTime @default(now())
  lastActive  DateTime @default(now()) // последний день активности пользователя
  costume     String?  // "crown", "superhero", "party_hat", "wings", "golden_aura"
  roomLevel   Int      @default(1) // уровень комнаты (1-5: пустая → дворец)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### API endpoints

```
GET    /achievements          # все достижения (разблокированные и заблокированные)
POST   /achievements/claim/:id # забрать награду
GET    /achievements/badges    # бейджи пользователя
GET    /themes                 # доступные темы оформления
PUT    /themes/active          # сменить тему

GET    /pet              # состояние питомца (health, happiness, level, xp, stage, isAlive)
PUT    /pet/feed         # покормить (ручное)
PUT    /pet/play         # поиграть (ручное)
PUT    /pet/name         # переименовать
POST   /pet/revive       # воскресить (проверяет выполнение условий)
GET    /pet/history      # история здоровья за неделю/месяц
GET    /pet/costumes     # доступные костюмы (разблокированные)
PUT    /pet/costume      # надеть костюм
```

## Визуальный прогресс

### Круговые индикаторы (Progress Rings)
- Главный экран: большой круг — прогресс дня (привычки + задачи)
- Внутри круга: процент и мотивирующий текст
- Для недели: 7 мини-кругов (пн-вс)
- Для года: тепловая карта (как GitHub) — зелёный за хорошие дни
- Анимация заполнения при отмечании привычки/задачи

### Категории свайпом
- Горизонтальный скролл карточек категорий
- Каждая карточка: иконка + название + мини-круг прогресса
- Свайп влево/вправо для переключения

### Мотивационная система
- Серии (streaks): "5 дней подряд!"
- Уровни: чем больше закрываешь, тем выше уровень
- Конфетти-анимация при 100% дня
- Цитаты из базы 600+ (загружены из Excel файлов)
- Вибрация + звук при отмечании привычки

## Уведомления

1. Утро (08:00): список задач + встречи + цитата дня + прогноз дня от ассистента
2. До задачи (за 30 мин): напоминание
3. До встречи (за 1 час + за 30 мин): напоминание с контекстом
4. Вечер (21:00): список невыполненных + итоги дня
4.5. Ночной ритуал: когда пользователь говорит "ложусь спать" / "спокойной ночи" / "отбой" — ассистент подводит итоги дня и говорит тёплые (или токсичные) слова в зависимости от стиля. Считает % выполнения дня (привычки + задачи) и выбирает тон ответа. Также можно активировать автоматически в 23:00 если пользователь ещё не отметил "отбой"
5. Воскресенье (20:00): итоги недели + план на следующую
6. Стрики: "Ты на серии N дней!"
7. Финансы: предупреждение при превышении 80% лимита
8. Мотивация: случайная цитата из базы 600+
9. Конфликты: уведомление при наложении задач и встреч

## Правила кода

1. TypeScript strict — никаких `any`
2. Функциональные компоненты, React.memo где нужно
3. StyleSheet.create, НЕ inline styles
4. Файлы: kebab-case, компоненты: PascalCase
5. Каждый компонент — отдельный файл
6. Zustand stores — по одному на модуль
7. API — через services/api.ts
8. Offline-first: работает без интернета, синхронизация при подключении
9. Все тексты UI на русском
10. try/catch с понятными сообщениями

## Этапы (работай строго по порядку)

### ЭТАП 0 — Подготовка
Expo проект + Fastify сервер + Prisma schema + monorepo + дизайн-система + базовые UI-компоненты (Button, Input, Card, Checkbox, ProgressRing)

### ЭТАП 1 — Задачи + Привычки
Auth (регистрация/вход/JWT) + CRUD задач + CRUD привычек + трекер привычек + задачи на неделю + месячная статистика

### ЭТАП 2 — Планер + Цели
Недельные цели + задачи в планере + аналитика недели + годовые цели + привязка привычек к целям + заметки дня

### ЭТАП 3 — Финансы
CRUD расходов/доходов + месячный обзор + топ-5 трат + диаграммы + лог расходов + лимиты бюджета (BudgetLimit) + категории расходов

### ЭТАП 4 — Шагомер + GPS
Педометр (фон) + GPS-трек + карта маршрута + автозакрытие привычек по шагам + HealthKit/Google Fit

### ЭТАП 5 — Голосовой AI + Ассистент-друг
Запись аудио + Whisper STT + Claude NLU + маппинг действий + TTS ответы + кнопка микрофона + личность ассистента (3 стиля) + диалог с контекстом + голосовое отмечание привычек/задач + умный финансовый анализ после каждого расхода + голосовое добавление встреч

### ЭТАП 5.5 — Импорт файлов + Календарь событий
expo-document-picker + загрузка на сервер + парсинг xlsx/csv/ics/pdf + Claude API для структурирования данных + CalendarEvent модель + умные напоминания о встречах + обнаружение конфликтов расписания + интеграция с утренним брифингом

### ЭТАП 6 — Уведомления
Push до задачи + до встречи + вечерняя проверка + утренний обзор + еженедельный отчёт + стрики + мотивация + финансовые предупреждения + конфликты расписания

### ЭТАП 7 — Дневник + Дашборд
Журнал (сон/энергия/настроение) + главный дашборд + графики + цитаты + круговые прогрессы + тепловая карта года + свайп категорий

### ЭТАП 8 — AI-чат + Интеграции
Встроенный AI-чат (мини-ChatGPT) с контекстом пользователя + Google Calendar синхронизация + Apple Calendar + Apple Health/Google Fit + Telegram бот + экспорт данных (CSV/PDF/Stories)

### ЭТАП 9 — Полировка + Запуск
Анимации + тёмная/светлая тема + онбординг + тесты + оптимизация + App Store / Google Play
