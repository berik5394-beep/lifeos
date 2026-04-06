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
  unknown: () => 'Не удалось распознать команду. Попробуйте ещё раз.',
};

export async function processVoiceCommand(transcribedText: string): Promise<VoiceResult> {
  const intent = await parseIntent(transcribedText);

  const templateFn = responseTemplates[intent.action] ?? responseTemplates.unknown;
  const response = templateFn(intent as Record<string, unknown>);

  return { intent, response };
}
