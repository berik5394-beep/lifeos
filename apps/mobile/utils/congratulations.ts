import { Alert } from 'react-native';

const TASK_PRAISES: string[] = [
  '🎉 Отлично! Задача выполнена!',
  '💪 Молодец! Так держать!',
  '🔥 Красавчик! Ещё одна задача закрыта!',
  '⭐ Супер! Продолжай в том же духе!',
  '🏆 Задача сделана! Ты на пути к цели!',
];

const HABIT_PRAISES: string[] = [
  '🎯 Привычка отмечена! Ты молодец!',
  '🔥 Серия продолжается! Так держать!',
  '💪 Ежедневная победа! Гордись собой!',
  '⭐ Отлично! Ещё один шаг к цели!',
  '🏅 Привычка выполнена! Ты становишься лучше!',
];

const ALL_DONE_PRAISES: string[] = [
  '🎊 ВСЕ ЗАДАЧИ ВЫПОЛНЕНЫ! Ты герой дня!',
  '🏆 100%! Идеальный день! Отдыхай с чистой совестью!',
  '🌟 Всё сделано! Ты невероятный!',
];

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function praiseTaskCompletion(): void {
  const msg = pickRandom(TASK_PRAISES);
  Alert.alert('\u2705', msg);
}

export function praiseHabitCompletion(): void {
  const msg = pickRandom(HABIT_PRAISES);
  Alert.alert('\u2705', msg);
}

export function praiseAllDone(): void {
  const msg = pickRandom(ALL_DONE_PRAISES);
  Alert.alert('🎊', msg);
}
