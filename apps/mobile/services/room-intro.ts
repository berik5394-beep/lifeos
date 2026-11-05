import { storage } from '@/services/storage';
import { TOOL_KEYS, toolsInItem, type ToolKey } from '@/services/room-tools';
import type { RoomItemKey } from '@/services/room-catalog';

/**
 * Робот-эпик: знакомство после установки — робот коротко показывает, что
 * умеет приложение, подсвечивая место на экране. И маленькие значки на мебели:
 * что лежит внутри. Чистые функции + флаг «тур пройден» (jest).
 */
export type IntroTarget = 'none' | 'input' | 'tools' | 'furniture' | 'furnish' | 'room';

export interface IntroStep {
  target: IntroTarget;
  text: string;
}

export const INTRO_STEPS: readonly IntroStep[] = [
  { target: 'none', text: 'Привет! Я твой робот-помощник, а это наш дом. Давай покажу, что я умею — это займёт полминуты.' },
  {
    target: 'input',
    text: 'Пиши или говори мне вот здесь: «купить хлеб завтра», «потратил 3000 на обед», «встреча в 15:00» — я всё запишу.',
  },
  {
    target: 'tools',
    text: 'Задачи, календарь, привычки, цели, финансы и дневник — в «Инструментах». Попросишь — я достану и расскажу, что там важного.',
  },
  {
    target: 'furniture',
    text: 'Инструменты живут в мебели: значок на предмете показывает, что внутри. Нажми на шкаф — достану календарь.',
  },
  { target: 'furnish', text: '«Обставить» — тут мебель для нашего дома. Чем уютнее комната, тем мне веселее работать!' },
  { target: 'room', text: 'Двойное нажатие на комнату — приблизить, ещё раз — отдалить. Ну что, начнём?' },
];

const INTRO_KEY = 'room_intro_done';

export function isIntroDone(): boolean {
  return storage.getString(INTRO_KEY) === 'true';
}
export function markIntroDone(): void {
  storage.set(INTRO_KEY, 'true');
}

/** Значок инструмента — маленький, на мебели и в подсказках. */
export const TOOL_ICON: Record<ToolKey, string> = {
  today: '☀️',
  tasks: '✅',
  habits: '🔁',
  goals: '🎯',
  finance: '💰',
  calendar: '📅',
  journal: '📓',
};

/** Значок на предмете мебели: что в нём лежит (только видимые инструменты). Пусто → ''. */
export function furnitureBadge(itemKey: RoomItemKey, visible: readonly string[] = TOOL_KEYS): string {
  return toolsInItem(itemKey)
    .filter((t) => visible.includes(t))
    .map((t) => TOOL_ICON[t])
    .join('');
}
