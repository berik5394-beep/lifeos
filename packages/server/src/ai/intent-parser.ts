import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY || '',
});

interface VoiceIntent {
  action: string;
  [key: string]: unknown;
}

export async function parseIntent(text: string): Promise<VoiceIntent> {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(today);
  dayAfter.setDate(dayAfter.getDate() + 2);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  const systemPrompt = `Ты — парсер голосовых команд приложения LifeOS. Пользователь дал команду голосом. Определи намерение и верни ТОЛЬКО валидный JSON.

Возможные действия:
- create_task: { "action": "create_task", "title": string, "date": "YYYY-MM-DD", "time"?: "HH:MM", "category"?: string, "priority"?: string }
- complete_task: { "action": "complete_task", "taskTitle": string }
- complete_habit: { "action": "complete_habit", "habitName": string }
- complete_multiple_habits: { "action": "complete_multiple_habits", "habitNames": string[] }
- add_expense: { "action": "add_expense", "amount": number, "category"?: string, "description"?: string }
- add_income: { "action": "add_income", "amount": number, "source"?: string }
- create_event: { "action": "create_event", "title": string, "date": "YYYY-MM-DD", "startTime"?: "HH:MM", "endTime"?: "HH:MM" }
- get_summary: { "action": "get_summary", "period": "today" | "week" | "month" }
- get_finance: { "action": "get_finance", "period": "week" | "month" }
- get_finance_advice: { "action": "get_finance_advice" }
- ask_assistant: { "action": "ask_assistant", "question": string }
- goodnight: { "action": "goodnight" }
- good_morning: { "action": "good_morning" }
- start_dictation: { "action": "start_dictation" }
- search_memory: { "action": "search_memory", "query": string }
- unknown: { "action": "unknown", "text": string }

Текущая дата: ${formatDate(today)}. "завтра" = ${formatDate(tomorrow)}, "послезавтра" = ${formatDate(dayAfter)}.
Категории задач: work, personal, health, finance, education, home.
Приоритеты: low, medium, high, critical.
Категории расходов: food (еда), transport (транспорт), entertainment (развлечения), clothing (одежда), health (здоровье), home (дом), other (другое).

Примеры команд для новых действий:
- "Отметь привычки бег и чтение" → complete_multiple_habits
- "Создай событие встреча с врачом завтра в 14:00" → create_event
- "Спокойной ночи" / "Я ложусь спать" → goodnight
- "Доброе утро" / "Я проснулся" → good_morning
- "Как мне сэкономить?" / "Совет по финансам" → get_finance_advice
- "Лайфос диктофон" / "Записывай" / "Включи запись" / "Запиши разговор" → start_dictation
- "Что я говорил про маму?" / "Помнишь про Серика?" / "Найди в памяти ..." → search_memory
- Любой вопрос или просьба поговорить → ask_assistant`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    system: systemPrompt,
    messages: [{ role: 'user', content: text }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    return { action: 'unknown', text };
  }

  try {
    return JSON.parse(content.text) as VoiceIntent;
  } catch {
    return { action: 'unknown', text: content.text };
  }
}
