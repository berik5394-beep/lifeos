# LifeOS — Конкурентный анализ: как убить все минусы рынка

## СВОДНАЯ ТАБЛИЦА: 27 ПРОБЛЕМ РЫНКА → 27 РЕШЕНИЙ LIFEOS

| # | Проблема рынка | Кто страдает | Решение LifeOS | Статус |
|---|---------------|-------------|----------------|--------|
| 1 | Перегруженный интерфейс | TickTick, ClickUp, Singularity | Adaptive UI: 3 уровня сложности | **НОВОЕ** |
| 2 | Проблемы синхронизации | Todoist, ЛидерТаск | Offline-first + MMKV + фоновый sync | Уже в архитектуре |
| 3 | Слабая/дорогая командная работа | Todoist, TickTick, Any.do | SharedSpace: бесплатно для 3 человек | **НОВОЕ** |
| 4 | Мало AI-фич | Все кроме ClickUp (и тот слабо) | J.A.R.V.I.S. Engine: полный AI | Уже в спеке |
| 5 | Нет зависимостей задач | Todoist, TickTick | TaskChain: блокеры + автоперенос | **НОВОЕ** |
| 6 | Устаревший дизайн | ЛидерТаск, Singularity | Тёмный premium UI + 6 тем | Уже в дизайне |
| 7 | Слишком много опций при добавлении | Todoist | Quick Add: 1 поле + AI допарсит | **НОВОЕ** |
| 8 | Нет встроенного календаря | Todoist | Полный календарь + expo-calendar sync | Уже в спеке |
| 9 | Перегруженные виды "Сегодня" | Todoist, ClickUp | Focus Mode: 1 задача на экране | **НОВОЕ** |
| 10 | Нет зависимостей задач | TickTick, Todoist | depends_on / blocks в Prisma | **НОВОЕ** |
| 11 | Слабый web-clipper | TickTick | Share Extension (iOS/Android) | **НОВОЕ** |
| 12 | Нет вложенных списков | TickTick | Безлимитная вложенность подзадач | **НОВОЕ** |
| 13 | Дизайн "не премиальный" | TickTick, ЛидерТаск | Glassmorphism + Reanimated анимации | Уже в стеке |
| 14 | Всё полезное в платной версии | Any.do | Freemium: 90% бесплатно, платно только AI premium и темы | **НОВОЕ** |
| 15 | Нет диаграмм Ганта/отчётов | Any.do | Графики Victory-native + тепловая карта | Уже в спеке |
| 16 | Слабые автоматизации | Any.do, Todoist | AI-автоматизации + привычки-автозакрытие | Уже в спеке |
| 17 | Нет Kanban-досок | Any.do | Kanban вид для задач (свайп по колонкам) | **НОВОЕ** |
| 18 | Слишком базовый | Microsoft To Do | Всё-в-одном: задачи+привычки+финансы+цели+календарь | Уже в спеке |
| 19 | Нет тегов и фильтров | Microsoft To Do | Теги + умные фильтры + AI-сортировка | **НОВОЕ** |
| 20 | Глючная синхронизация при объёме | ЛидерТаск | Optimistic UI + queue-based sync | **НОВОЕ** |
| 21 | Подписка только на год | ЛидерТаск | Помесячная подписка + lifetime deal | **НОВОЕ** |
| 22 | Крутая кривая обучения | SingularityApp, ClickUp | Онбординг 5 шагов + AI-гид | **НОВОЕ** |
| 23 | Подзадачи = простые чек-листы | SingularityApp | Полные подзадачи с приоритетом, датой, назначением | **НОВОЕ** |
| 24 | Авто-продление без предупреждений | SingularityApp | Предупреждение за 7 дней + лёгкая отмена | **НОВОЕ** |
| 25 | Trello: хаос при масштабе | Trello | AI-приоритизация + автогруппировка | Уже в спеке |
| 26 | ClickUp: перегружен | ClickUp | Adaptive UI (см. пункт 1) | **НОВОЕ** |
| 27 | Нет голосового ввода с диалогом | ВСЕ | J.A.R.V.I.S. Voice Conversation Engine | Уже в спеке |

---

## ДЕТАЛЬНЫЙ РАЗБОР: 10 КЛЮЧЕВЫХ ПРЕИМУЩЕСТВ LIFEOS

### 1. ADAPTIVE UI — Три уровня интерфейса

**Проблема:** ClickUp, SingularityApp, TickTick перегружают экран. Новичок открывает — и закрывает. Опытный пользователь в Microsoft To Do — скучает.

**Решение LifeOS: переключаемые режимы интерфейса.**

```typescript
// apps/mobile/stores/useUIStore.ts

type UIComplexity = 'simple' | 'standard' | 'power';

interface UIState {
  complexity: UIComplexity;
  setComplexity: (c: UIComplexity) => void;
}

export const useUIStore = create<UIState>((set) => ({
  complexity: 'standard',
  setComplexity: (complexity) => set({ complexity }),
}));

// Что показывается на каждом уровне:

const UI_FEATURES: Record<UIComplexity, string[]> = {
  simple: [
    // Только самое важное — как Microsoft To Do, но красиво
    'tasks_today',        // Задачи на сегодня (список)
    'habits_checkmarks',  // Привычки (галочки)
    'quick_add',          // Одна кнопка "+" 
    'voice_button',       // Микрофон
    'progress_ring',      // Один круг прогресса
    // НЕТ: финансов, целей, графиков, Kanban
  ],

  standard: [
    // Основной режим — как Todoist+TickTick, но лучше
    ...UI_FEATURES.simple,
    'finance_tab',        // Вкладка финансов
    'goals_tab',          // Цели на год
    'weekly_planner',     // Недельный планер
    'charts_basic',       // Базовые графики
    'calendar_view',      // Календарь
    'pet_widget',         // Питомец (маленький)
    'journal',            // Дневник
  ],

  power: [
    // Для продвинутых — как ClickUp, но без хаоса
    ...UI_FEATURES.standard,
    'kanban_view',        // Kanban-доски
    'gantt_view',         // Диаграмма Ганта (горизонтальный таймлайн)
    'dependencies',       // Зависимости задач
    'tags_filters',       // Теги и умные фильтры
    'automations',        // Автоматизации
    'heatmap_year',       // Тепловая карта года
    'export_reports',     // Экспорт отчётов
    'shared_spaces',      // Командная работа
    'advanced_analytics', // Детальная аналитика
  ],
};
```

**Онбординг спрашивает:**
```
"Как ты планируешь свой день?"

🟢 Просто — список дел и привычки (Simple)
🔵 С деталями — задачи, финансы, цели (Standard)  
🔴 По полной — Kanban, зависимости, аналитика (Power)

"Ты всегда можешь переключить в настройках!"
```

**Почему это убивает конкурентов:**
- ClickUp/Singularity: сразу показывают ВСЁ → пользователь пугается → удаляет
- Microsoft To Do: всегда простой → вырастаешь из него → уходишь
- LifeOS: растёт вместе с пользователем. Начал с Simple, через месяц перешёл на Standard, через полгода — Power. Не нужно менять приложение.

---

### 2. QUICK ADD — Умное добавление задачи в 1 поле

**Проблема Todoist:** при добавлении задачи показывает дату, приоритет, метки, проект, раздел, напоминание — 6+ полей. Новичку страшно.

**Решение LifeOS: одно текстовое поле + AI парсит остальное.**

```typescript
// apps/mobile/components/tasks/QuickAddTask.tsx

// Пользователь пишет в ОДНО поле:
// "Купить молоко завтра" 
//   → AI: title="Купить молоко", date=завтра, category=home, priority=low

// "Встреча с Канатом в среду в 14:00 важно"
//   → AI: title="Встреча с Канатом", date=среда, time=14:00, priority=high

// "Заплатить за квартиру 85000"
//   → AI: title="Заплатить за квартиру", category=finance, priority=high
//   → Предложение: "Записать как расход 85 000 ₸ в категорию Дом?"

// Голосом: "Создай задачу купить продукты на завтра"
//   → то же самое, без экранов

interface QuickAddProps {
  onTaskCreated: (task: Task) => void;
}

export function QuickAddTask({ onTaskCreated }: QuickAddProps) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedTask | null>(null);

  const handleSubmit = async () => {
    // 1. Отправляем текст на сервер для AI-парсинга
    const { data } = await api.post('/tasks/quick-add', { text });
    
    // 2. Показываем превью (пользователь может поправить)
    setParsed(data.parsed);
    
    // 3. Если уверенность высокая — создаём сразу
    if (data.confidence === 'high') {
      onTaskCreated(data.task);
      setText('');
      setParsed(null);
    }
    // Иначе — показываем карточку для подтверждения
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Что нужно сделать?"
        value={text}
        onChangeText={setText}
        onSubmitEditing={handleSubmit}
        returnKeyType="done"
      />
      <TouchableOpacity style={styles.micButton} onPress={startVoice}>
        <MicrophoneIcon />
      </TouchableOpacity>
    </View>
  );
}
```

**Серверная часть — AI парсер:**

```typescript
// packages/server/src/services/quick-add-parser.ts

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export async function parseQuickAdd(text: string, userId: string): Promise<ParsedTask> {
  const today = new Date().toISOString().split('T')[0];
  const dayOfWeek = ['вс','пн','вт','ср','чт','пт','сб'][new Date().getDay()];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    system: `Ты парсер задач. Извлеки из текста: title, date (YYYY-MM-DD), time (HH:MM или null), 
category (work/personal/health/finance/education/home), priority (low/medium/high/critical).
Сегодня: ${today} (${dayOfWeek}). "завтра" = +1 день, "в среду" = ближайшая среда.
Верни ТОЛЬКО JSON. Если дата не указана — date = "${today}". 
Если приоритет не указан — определи по контексту (оплата/встреча = high, покупки = low).
Также верни confidence: "high" если всё понятно, "medium" если есть сомнения.`,
    messages: [{ role: 'user', content: text }],
  });

  const json = JSON.parse(response.content[0].type === 'text' ? response.content[0].text : '{}');
  return json;
}
```

---

### 3. TASK DEPENDENCIES — Зависимости и блокеры

**Проблема:** Todoist, TickTick, Any.do — ни у кого нет зависимостей. "Задача Б не может начаться, пока не сделана задача А." Критично для проектов.

**Решение LifeOS: depends_on / blocks + автоматический перенос.**

```prisma
// Добавить в schema.prisma

model Task {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  title       String
  category    String
  priority    String
  date        DateTime @db.Date
  time        String?
  completed   Boolean  @default(false)
  notes       String?
  
  // НОВОЕ: Зависимости
  parentId    String?              // Родительская задача (подзадачи)
  parent      Task?    @relation("SubTasks", fields: [parentId], references: [id])
  subtasks    Task[]   @relation("SubTasks")
  
  dependsOn   TaskDependency[] @relation("DependentTask")  // от каких задач зависит
  blocks      TaskDependency[] @relation("BlockingTask")    // какие задачи блокирует
  
  // НОВОЕ: Теги
  tags        TaskTag[]
  
  // НОВОЕ: Повторение
  recurrence  String?  // "daily", "weekly:mon,wed,fri", "monthly:15", "yearly:03-15"
  
  // НОВОЕ: Время (для Gantt)
  estimatedMinutes Int?    // Оценка времени выполнения
  actualMinutes    Int?    // Фактическое время
  
  createdAt   DateTime @default(now())
}

model TaskDependency {
  id             String @id @default(cuid())
  dependentId    String // Задача, которая ЗАВИСИТ
  dependent      Task   @relation("DependentTask", fields: [dependentId], references: [id])
  blockingId     String // Задача, которая БЛОКИРУЕТ
  blocking       Task   @relation("BlockingTask", fields: [blockingId], references: [id])
  type           String @default("finish_to_start") // "finish_to_start", "start_to_start"
  @@unique([dependentId, blockingId])
}

model Tag {
  id     String    @id @default(cuid())
  userId String
  user   User      @relation(fields: [userId], references: [id])
  name   String
  color  String    @default("#6366F1")
  tasks  TaskTag[]
  @@unique([userId, name])
}

model TaskTag {
  taskId String
  task   Task   @relation(fields: [taskId], references: [id], onDelete: Cascade)
  tagId  String
  tag    Tag    @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([taskId, tagId])
}
```

**Логика автопереноса:**

```typescript
// packages/server/src/services/task-dependencies.ts

// Когда задача-блокер завершается → разблокируем зависимые
export async function onTaskCompleted(taskId: string, userId: string): Promise<void> {
  // 1. Найти все задачи, которые ждали эту
  const dependents = await prisma.taskDependency.findMany({
    where: { blockingId: taskId },
    include: { dependent: true },
  });

  for (const dep of dependents) {
    // 2. Проверить: все блокеры этой задачи выполнены?
    const allBlockers = await prisma.taskDependency.findMany({
      where: { dependentId: dep.dependentId },
      include: { blocking: true },
    });

    const allResolved = allBlockers.every(b => b.blocking.completed);

    if (allResolved) {
      // 3. Задача разблокирована! Уведомить пользователя
      await sendNotification(userId, {
        title: '🔓 Задача разблокирована',
        body: `"${dep.dependent.title}" теперь можно выполнить!`,
      });
    }
  }
}

// Когда задачу-блокер переносят → автоматически переносим зависимые
export async function onTaskRescheduled(
  taskId: string, newDate: Date, userId: string
): Promise<{ rescheduled: string[] }> {
  const dependents = await prisma.taskDependency.findMany({
    where: { blockingId: taskId },
    include: { dependent: true },
  });

  const rescheduled: string[] = [];

  for (const dep of dependents) {
    // Если зависимая задача раньше нового дедлайна блокера — переносим
    if (dep.dependent.date < newDate) {
      const newDependentDate = new Date(newDate);
      newDependentDate.setDate(newDependentDate.getDate() + 1); // На следующий день после блокера

      await prisma.task.update({
        where: { id: dep.dependentId },
        data: { date: newDependentDate },
      });

      rescheduled.push(dep.dependent.title);

      // Рекурсивно — каскадный перенос
      await onTaskRescheduled(dep.dependentId, newDependentDate, userId);
    }
  }

  return { rescheduled };
}
```

**Голосовая интеграция:**

```
Пользователь: "Задача 'написать отчёт' зависит от 'собрать данные'"
AI → create_dependency({ dependent: "написать отчёт", blocking: "собрать данные" })
AI: "Готово. Пока не закроешь 'собрать данные', отчёт будет заблокирован. 
     Напомню когда можно будет начать."
```

---

### 4. FOCUS MODE — Режим фокуса (1 задача на экране)

**Проблема:** "Сегодня" в Todoist/TickTick показывает 15+ задач. Парализует. Непонятно с чего начать.

**Решение: Focus Mode — показываем ОДНУ задачу + таймер Pomodoro.**

```typescript
// apps/mobile/app/focus.tsx

export default function FocusScreen() {
  const { currentTask, nextTask, completeAndNext } = useFocusMode();
  const { minutes, seconds, isRunning, start, pause, reset } = usePomodoro(25);

  if (!currentTask) {
    return (
      <View style={styles.center}>
        <Text style={styles.doneText}>Все задачи на сегодня выполнены!</Text>
        <LottieView source={confettiAnimation} autoPlay />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Только одна задача — большим шрифтом по центру */}
      <View style={styles.taskCard}>
        <Text style={styles.category}>{getCategoryLabel(currentTask.category)}</Text>
        <Text style={styles.taskTitle}>{currentTask.title}</Text>
        {currentTask.time && <Text style={styles.time}>до {currentTask.time}</Text>}
      </View>

      {/* Pomodoro таймер */}
      <View style={styles.timer}>
        <Text style={styles.timerText}>
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </Text>
        <TouchableOpacity onPress={isRunning ? pause : start}>
          <Text style={styles.timerButton}>{isRunning ? 'Пауза' : 'Старт'}</Text>
        </TouchableOpacity>
      </View>

      {/* Действия */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.completeButton} onPress={() => completeAndNext()}>
          <Text style={styles.completeText}>Готово ✅</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipButton} onPress={() => completeAndNext(true)}>
          <Text style={styles.skipText}>Пропустить →</Text>
        </TouchableOpacity>
      </View>

      {/* Внизу мелко: следующая задача */}
      {nextTask && (
        <Text style={styles.nextHint}>Следующая: {nextTask.title}</Text>
      )}
    </View>
  );
}

// Хук: AI сортирует задачи по приоритету и контексту
function useFocusMode() {
  const tasks = useTaskStore(s => s.todayTasks.filter(t => !t.completed));
  
  // AI-сортировка: urgent+important первые, зависимости учтены
  const sorted = useMemo(() => sortByAIPriority(tasks), [tasks]);
  
  return {
    currentTask: sorted[0] ?? null,
    nextTask: sorted[1] ?? null,
    completeAndNext: async (skip = false) => {
      if (!skip && sorted[0]) {
        await api.patch(`/tasks/${sorted[0].id}/complete`);
      }
    },
  };
}
```

---

### 5. SMART SYNC — Offline-first без глюков

**Проблема:** ЛидерТаск глючит при большом объёме. Todoist — задачи не сразу на всех устройствах.

**Решение LifeOS: Offline-first с optimistic UI и очередью синхронизации.**

```typescript
// apps/mobile/services/sync-engine.ts

import { MMKV } from 'react-native-mmkv';
import NetInfo from '@react-native-community/netinfo';

const storage = new MMKV();
const SYNC_QUEUE_KEY = 'sync_queue';

type SyncAction = {
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  body: any;
  timestamp: number;
  retries: number;
};

// 1. Все действия СНАЧАЛА сохраняются локально (MMKV)
// 2. UI обновляется МГНОВЕННО (optimistic)
// 3. В фоне — отправка на сервер через очередь

export function enqueueSync(action: Omit<SyncAction, 'id' | 'timestamp' | 'retries'>) {
  const queue = getQueue();
  queue.push({
    ...action,
    id: generateId(),
    timestamp: Date.now(),
    retries: 0,
  });
  storage.set(SYNC_QUEUE_KEY, JSON.stringify(queue));
  
  // Попробовать синхронизировать сразу
  processQueue();
}

async function processQueue() {
  const isConnected = (await NetInfo.fetch()).isConnected;
  if (!isConnected) return; // Нет сети — подождём

  const queue = getQueue();
  const newQueue: SyncAction[] = [];

  for (const action of queue) {
    try {
      await api.request({
        method: action.method,
        url: action.endpoint,
        data: action.body,
      });
      // Успех — не добавляем обратно в очередь
    } catch (err) {
      if (action.retries < 5) {
        newQueue.push({ ...action, retries: action.retries + 1 });
      }
      // После 5 попыток — дропаем и уведомляем
    }
  }

  storage.set(SYNC_QUEUE_KEY, JSON.stringify(newQueue));
}

// Слушаем изменения сети — синхронизируем при подключении
NetInfo.addEventListener(state => {
  if (state.isConnected) processQueue();
});

function getQueue(): SyncAction[] {
  const raw = storage.getString(SYNC_QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}
```

**Почему это лучше конкурентов:**
- Todoist: отправляет на сервер, ждёт ответа → лаг
- ЛидерТаск: синхронизация "висит" при большом объёме
- LifeOS: UI обновляется за 0ms (MMKV), синхронизация в фоне, конфликты резолвятся по last-write-wins с merge для массивов

---

### 6. KANBAN + GANTT — Для Power-пользователей

**Проблема:** Any.do — нет Kanban. Todoist — нет Gantt. TickTick — нет ни того, ни другого.

**Решение LifeOS: оба вида, но только в Power режиме (не пугают новичков).**

```typescript
// apps/mobile/components/tasks/KanbanView.tsx

// Колонки Kanban:
const KANBAN_COLUMNS = [
  { id: 'backlog',     label: 'Бэклог',      color: '#6B7280' },
  { id: 'todo',        label: 'К выполнению', color: '#3B82F6' },
  { id: 'in_progress', label: 'В работе',     color: '#F59E0B' },
  { id: 'done',        label: 'Готово',       color: '#22C55E' },
];

// Перетаскивание карточек между колонками
// react-native-draggable-flatlist для drag & drop
// Свайп влево/вправо для перемещения между колонками на мобильном

export function KanbanView() {
  const tasks = useTaskStore(s => s.weekTasks);
  
  const columns = KANBAN_COLUMNS.map(col => ({
    ...col,
    tasks: tasks.filter(t => t.kanbanStatus === col.id),
  }));

  return (
    <ScrollView horizontal pagingEnabled>
      {columns.map(col => (
        <View key={col.id} style={[styles.column, { borderTopColor: col.color }]}>
          <Text style={styles.columnTitle}>{col.label} ({col.tasks.length})</Text>
          <FlatList
            data={col.tasks}
            renderItem={({ item }) => (
              <TaskCard task={item} onSwipeLeft={() => moveTask(item, 'left')} onSwipeRight={() => moveTask(item, 'right')} />
            )}
          />
        </View>
      ))}
    </ScrollView>
  );
}
```

**Gantt (горизонтальный таймлайн):**

```typescript
// apps/mobile/components/tasks/GanttView.tsx

// Упрощённый Gantt для мобильного:
// Горизонтальная шкала дней, задачи как полоски
// Зависимости показаны стрелками

export function GanttView() {
  const tasks = useTaskStore(s => s.weekTasks);
  const dependencies = useDependencies();

  return (
    <ScrollView horizontal>
      <View style={styles.ganttContainer}>
        {/* Шкала дней сверху */}
        <View style={styles.dateScale}>
          {weekDays.map(day => (
            <View key={day} style={styles.dayColumn}>
              <Text style={styles.dayLabel}>{formatDay(day)}</Text>
            </View>
          ))}
        </View>

        {/* Задачи как полоски */}
        {tasks.map(task => (
          <View key={task.id} style={[styles.taskBar, {
            left: getTaskPosition(task.date),
            width: getTaskWidth(task.estimatedMinutes || 60),
            backgroundColor: getCategoryColor(task.category),
          }]}>
            <Text style={styles.taskBarText}>{task.title}</Text>
          </View>
        ))}

        {/* Стрелки зависимостей (SVG) */}
        <Svg style={StyleSheet.absoluteFill}>
          {dependencies.map(dep => (
            <Line
              key={dep.id}
              x1={getTaskEnd(dep.blockingId)}
              y1={getTaskY(dep.blockingId)}
              x2={getTaskStart(dep.dependentId)}
              y2={getTaskY(dep.dependentId)}
              stroke={colors.warning}
              strokeWidth={2}
              markerEnd="url(#arrow)"
            />
          ))}
        </Svg>
      </View>
    </ScrollView>
  );
}
```

---

### 7. AI-ПРИОРИТИЗАЦИЯ — Автоматическая сортировка задач

**Проблема всех планеров:** пользователь сам расставляет приоритеты. Часто неправильно — делает "срочное", а не "важное".

**Решение LifeOS: AI-приоритизация по матрице Эйзенхауэра + контекст.**

```typescript
// packages/server/src/services/ai-prioritizer.ts

export async function prioritizeTasks(userId: string): Promise<PrioritizedTask[]> {
  const context = await buildInitialContext(userId);
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: `Ты эксперт по продуктивности. Отсортируй задачи пользователя по важности.
Используй матрицу Эйзенхауэра:
1. Срочно + Важно → делать ПЕРВЫМ
2. Важно + Не срочно → запланировать
3. Срочно + Не важно → делегировать/быстро закрыть
4. Не срочно + Не важно → отложить/удалить

Учитывай:
- Время дня (${context.today.time}): утром — сложные задачи, после обеда — рутина
- Встречи: не ставь сложное перед встречей
- Дедлайны: задача на сегодня с дедлайном → выше
- Зависимости: заблокированные задачи → ниже
- Энергию пользователя: ${context.journal?.energy ?? 'неизвестно'}/10

Верни JSON массив id задач в порядке приоритета + краткое объяснение для каждой.`,
    messages: [{
      role: 'user',
      content: JSON.stringify(context.tasks.items),
    }],
  });

  return JSON.parse(response.content[0].type === 'text' ? response.content[0].text : '[]');
}
```

---

### 8. SHARED SPACES — Командная работа (бесплатно для 3 человек)

**Проблема:** Todoist/TickTick — совместная работа платная или кривая. Trello — хаос. Asana — дорого.

**Решение LifeOS: SharedSpace — лёгкие общие списки.**

```prisma
model SharedSpace {
  id          String   @id @default(cuid())
  name        String
  ownerId     String
  owner       User     @relation("OwnedSpaces", fields: [ownerId], references: [id])
  members     SharedSpaceMember[]
  tasks       Task[]   // задачи привязанные к space
  createdAt   DateTime @default(now())
}

model SharedSpaceMember {
  id       String      @id @default(cuid())
  spaceId  String
  space    SharedSpace @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  userId   String
  user     User        @relation(fields: [userId], references: [id])
  role     String      @default("member") // "owner", "admin", "member"
  @@unique([spaceId, userId])
}
```

**Сценарий:**
```
Берик: "LifeOS, создай общий список 'Ремонт квартиры' и добавь Айгуль"

LifeOS:
1. Создаёт SharedSpace "Ремонт квартиры"
2. Ищет Айгуль в контактах → находит
3. Отправляет инвайт через push/WhatsApp
4. Айгуль устанавливает LifeOS → видит общий список
5. Оба могут добавлять задачи, отмечать выполненные
6. AI: "Берик, Айгуль добавила задачу 'Выбрать плитку'. Хочешь назначить дедлайн?"
```

---

### 9. SMART ONBOARDING — 5 шагов вместо обучения

**Проблема SingularityApp/ClickUp:** крутая кривая обучения. Пользователь не понимает с чего начать.

**Решение LifeOS: AI-гид, 5 экранов, настройка за 2 минуты.**

```typescript
// apps/mobile/app/onboarding/steps.ts

const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    title: 'Привет! Я LifeOS',
    subtitle: 'Твой персональный AI-помощник',
    action: 'Выбери как тебя зовут',
    // Поле: имя
  },
  {
    id: 'complexity',
    title: 'Как ты планируешь день?',
    options: [
      { value: 'simple', label: 'Просто — список дел', icon: '📝' },
      { value: 'standard', label: 'С деталями — задачи, финансы', icon: '📊' },
      { value: 'power', label: 'По полной — всё и сразу', icon: '🚀' },
    ],
    // → устанавливает UIComplexity
  },
  {
    id: 'assistant',
    title: 'Какой у меня характер?',
    subtitle: 'Выбери как я буду с тобой общаться',
    options: [
      { value: 'friendly', label: 'Дружелюбный', desc: 'Как лучший друг', icon: '😊' },
      { value: 'strict', label: 'Строгий тренер', desc: 'Без отмазок', icon: '💪' },
      { value: 'calm', label: 'Спокойный наставник', desc: 'Мудрый и тихий', icon: '🧘' },
      { value: 'toxic', label: 'Токсичный', desc: '⚠️ Будет грубить!', icon: '🔥' },
    ],
    // + Выбор пола ассистента
  },
  {
    id: 'pet',
    title: 'Выбери питомца',
    subtitle: 'Он будет расти вместе с тобой',
    options: [
      { value: 'cat', label: 'Котик', icon: '🐱' },
      { value: 'dog', label: 'Собачка', icon: '🐶' },
      { value: 'fox', label: 'Лисёнок', icon: '🦊' },
      { value: 'owl', label: 'Совёнок', icon: '🦉' },
    ],
    // Имя питомца
  },
  {
    id: 'first_tasks',
    title: 'Давай начнём!',
    subtitle: 'Скажи мне голосом или напиши — что нужно сделать сегодня?',
    // Поле Quick Add + микрофон
    // AI сразу создаёт первые задачи из голосового ввода
  },
];
```

**Весь онбординг — 5 экранов, 2 минуты.** Никаких туториалов, видео, подсказок. Приложение настроено и готово.

---

### 10. FREEMIUM БЕЗ ИСКУССТВЕННЫХ ОГРАНИЧЕНИЙ

**Проблема:** Any.do, Todoist, SingularityApp — прячут полезное за paywall. ЛидерТаск — только годовая подписка.

**Решение LifeOS: щедрый бесплатный план.**

```
БЕСПЛАТНО (навсегда):
✅ Безлимитные задачи, привычки, цели
✅ Календарь + синхронизация
✅ Финансовый трекер
✅ Дневник самочувствия
✅ Шагомер + GPS
✅ Питомец (все базовые функции)
✅ 3 голосовые команды в день
✅ Режимы Simple / Standard / Power
✅ Офлайн-режим
✅ SharedSpace до 3 человек
✅ Базовые графики и статистика
✅ 1 тема оформления

PRO (помесячно ИЛИ годовая со скидкой 40%):
⭐ Безлимитные голосовые команды
⭐ J.A.R.V.I.S. AI-ассистент (полный диалог)
⭐ Поиск авиабилетов и отелей
⭐ Построение маршрутов
⭐ AI-приоритизация задач
⭐ Зависимости задач + Kanban + Gantt
⭐ Все 6 тем оформления
⭐ Расширенная аналитика
⭐ Экспорт PDF/CSV/Stories
⭐ SharedSpace до 10 человек
⭐ Приоритетная поддержка
⭐ Все костюмы для питомца

LIFETIME (одноразовая покупка):
💎 Всё из PRO навсегда
💎 Ранний доступ к новым функциям
💎 Бейдж "OG" в профиле
```

---

## НОВЫЕ ФУНКЦИИ ДЛЯ ДОБАВЛЕНИЯ В LIFEOS (из анализа конкурентов)

### Функции которых НЕТ ни у кого и которые станут killer-features:

| Функция | Описание | Почему killer |
|---------|----------|--------------|
| **AI Daily Planner** | Утром AI автоматически составляет план дня с учётом привычек, встреч, энергии, погоды | Ни один конкурент не делает это автоматически |
| **Smart Reschedule** | Не успел задачу → AI предлагает оптимальный слот на завтра/неделю | Все конкуренты просто "переносят на завтра" |
| **Energy-based Planning** | Сложные задачи утром (высокая энергия), рутина вечером (низкая) | Учёт биоритмов — уникально |
| **Financial Impact** | "Если откажешься от кофе на вынос — сэкономишь 180 000 ₸/год" | Связь задач и финансов — никто не делает |
| **Habit-Task Bridge** | Привычка "чтение" автоматически создаёт задачу "читать 30 мин" каждый день | Привычки и задачи обычно в разных приложениях |
| **Life Score** | Ежедневный "балл жизни" (0-100) из всех данных: задачи+привычки+финансы+здоровье | Геймификация уровня Тамагочи |
| **Context Switching** | "Сейчас ты на работе" → показать рабочие задачи. "Ты дома" → домашние | Геолокация + автопереключение |
| **Weekly Reflection AI** | Воскресенье: AI анализирует неделю и предлагает улучшения на следующую | Автоматический ретро — уникально |

---

## СВОДКА: ПОЧЕМУ LIFEOS ПОБЕЖДАЕТ КАЖДОГО КОНКУРЕНТА

```
Todoist хочешь? → LifeOS Simple mode (но с AI и голосом)
TickTick хочешь? → LifeOS Standard mode (но без перегруза)
ClickUp хочешь? → LifeOS Power mode (но с мобильным UX)
Any.do хочешь? → LifeOS бесплатно даёт больше чем Any.do PRO
Microsoft To Do? → LifeOS Simple настолько же прост, но умнее
ЛидерТаск? → LifeOS работает оффлайн + современный дизайн + помесячная подписка
SingularityApp? → LifeOS проще в освоении + честный биллинг
Trello/Asana? → LifeOS SharedSpace + Kanban + без хаоса
```

**Главный killer-argument LifeOS:**
Ни одно приложение в мире не объединяет: задачи + привычки + финансы + календарь + голосовой AI-ассистент + питомец + здоровье + цели — в одном приложении с тремя уровнями сложности.

Пользователь **не уходит** из LifeOS, потому что:
1. Тут ВСЁ — не нужно 5 приложений
2. Питомец умрёт если уйдёшь
3. AI знает весь контекст и становится незаменимым
4. Данные за месяцы/годы — жалко терять
5. Растёт вместе с тобой (Simple → Standard → Power)
