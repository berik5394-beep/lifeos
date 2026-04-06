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
  add_expense: (i) => `Расход ${i.amount}₸ добавлен`,
  add_income: (i) => `Доход ${i.amount}₸ добавлен`,
  get_summary: () => 'Вот ваша сводка',
  get_finance: () => 'Вот финансовый отчёт',
  unknown: () => 'Не удалось распознать команду. Попробуйте ещё раз.',
};

export async function processVoiceCommand(transcribedText: string): Promise<VoiceResult> {
  const intent = await parseIntent(transcribedText);

  const templateFn = responseTemplates[intent.action] ?? responseTemplates.unknown;
  const response = templateFn(intent as Record<string, unknown>);

  return { intent, response };
}
