import { parseIntent } from './intent-parser.js';

interface VoiceResult {
  intent: {
    action: string;
    [key: string]: unknown;
  };
  response: string;
}

const responseTemplates: Record<string, (intent: Record<string, unknown>) => string> = {
  create_task: (i) => `Задача "${i.title}" создана на ${i.date}`,
  complete_task: (i) => `Задача "${i.taskTitle}" отмечена выполненной`,
  complete_habit: (i) => `Привычка "${i.habitName}" отмечена`,
  complete_multiple_habits: (i) => {
    const names = i.habitNames as string[];
    return `Привычки отмечены: ${names.join(', ')}`;
  },
  add_expense: (i) => `Расход ${i.amount}₸ добавлен`,
  add_income: (i) => `Доход ${i.amount}₸ добавлен`,
  create_event: (i) => {
    const time = i.startTime ? ` в ${i.startTime}` : '';
    return `Событие "${i.title}" создано на ${i.date}${time}`;
  },
  get_summary: () => 'Вот ваша сводка',
  get_finance: () => 'Вот финансовый отчёт',
  get_finance_advice: () => 'Подготовил финансовый совет',
  ask_assistant: () => 'Обрабатываю ваш вопрос',
  goodnight: () => 'Спокойной ночи! Подвожу итоги дня.',
  good_morning: () => 'Доброе утро! Вот план на сегодня.',
  // JARVIS: эти три действия мобилка должна перехватить и дёрнуть
  // соответствующие роуты (/dictation/process, /memory/search, /travel/smart-book).
  // Шаблоны здесь — fallback на случай если мобилка не подхватила action.
  start_dictation: () => 'Включаю запись. Говори свободно — я выделю задачи и запомню важное.',
  search_memory: (i) => `Ищу в памяти: ${i.query || ''}`,
  plan_travel: () => 'Подбираю варианты, секунду...',
  unknown: () => 'Не удалось распознать команду. Попробуйте ещё раз.',
};

// Heuristics: if Claude couldn't classify the intent but the user clearly spoke
// a sentence, treat it as a task. Users with the app open almost always want
// to *do something* — dropping their transcript on the floor with
// "не распознал" is the worst possible UX.
const QUESTION_MARKERS = [
  'как', 'сколько', 'когда', 'почему', 'зачем', 'что', 'где', 'кто', 'какой', 'какая', 'какие',
  'мотивируй', 'совет', 'помоги', 'расскажи', 'объясни',
];

function looksLikeQuestion(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (t.endsWith('?')) return true;
  const firstWord = t.split(/\s+/)[0] || '';
  return QUESTION_MARKERS.includes(firstWord);
}

export async function processVoiceCommand(transcribedText: string): Promise<VoiceResult> {
  const raw = transcribedText.trim();
  let intent = await parseIntent(raw);

  // Fallback: Claude said "unknown" but we still have a transcript.
  // Route it to the assistant (question) or create a task (statement).
  if (!intent?.action || intent.action === 'unknown') {
    if (looksLikeQuestion(raw)) {
      intent = { action: 'ask_assistant', question: raw };
    } else if (raw.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      intent = {
        action: 'create_task',
        title: raw,
        date: today,
        category: 'personal',
        priority: 'medium',
      };
    }
  }

  const templateFn = responseTemplates[intent.action] ?? responseTemplates.unknown;
  const response = templateFn(intent as Record<string, unknown>);

  return { intent, response };
}
