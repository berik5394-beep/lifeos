/**
 * «Сказал, что сделал» — в обратную сторону (Berik 2026-11-09, первые 60 секунд):
 * новичок одной фразой назвал дела, привычку и мечту; мозг создал 2 задачи и
 * привычку, а ответил только «Теперь по цели на машину — какая сумма?». Человек
 * не видит, что всё уже разложено, — пропадает «вау». Если за ход что-то
 * создано, а ответ об этом молчит, коротко перечисляем созданное перед ответом.
 */

export interface DoneItem {
  tool: string;
  /** Текст результата инструмента: «Задача "Сдать отчёт" создана на …». */
  message: string;
}

/** Что именно создано — по виду инструмента (единственное / множественное). */
const KIND: Record<string, [string, string]> = {
  create_task: ['задача', 'задачи'],
  create_habit: ['привычка', 'привычки'],
  create_goal: ['цель', 'цели'],
  create_yearly_goal: ['цель', 'цели'],
  create_weekly_goal: ['цель на неделю', 'цели на неделю'],
  create_monthly_goal: ['цель на месяц', 'цели на месяц'],
  create_event: ['встреча', 'встречи'],
  create_obligation: ['обещание', 'обещания'],
};

/** Название из текста результата: в «ёлочках» или "кавычках". */
export function quotedName(message: string): string | null {
  const m = message.match(/[«"]([^»"]{1,80})[»"]/);
  return m ? m[1].trim() : null;
}

/**
 * Добавить «Готово: задачи «…», «…»; привычка «…».» перед ответом, если ответ
 * не называет созданное. Только для создания (виды из KIND) с названием —
 * деньги/отметки и так говорят о себе через подтверждение «да?».
 */
export function withDoneSummary(reply: string, done: DoneItem[]): string {
  const groups = new Map<string, string[]>();
  for (const d of done) {
    if (!KIND[d.tool]) continue;
    const name = quotedName(d.message);
    if (!name) continue;
    const list = groups.get(d.tool) ?? [];
    if (!list.includes(name)) list.push(name);
    groups.set(d.tool, list);
  }
  if (groups.size === 0) return reply;
  const lower = reply.toLowerCase();
  const all = [...groups.values()].flat();
  // Ответ уже называет всё созданное — не дублируем.
  if (all.every((n) => lower.includes(n.toLowerCase()))) return reply;
  const parts = [...groups.entries()].map(([tool, names]) => {
    const [one, many] = KIND[tool];
    return `${names.length > 1 ? many : one} ${names.map((n) => `«${n}»`).join(', ')}`;
  });
  return `Готово: ${parts.join('; ')}.\n\n${reply}`.trim();
}
