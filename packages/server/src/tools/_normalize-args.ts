/**
 * Tool-reliability fix («барахлят инструменты»): нормализация входа
 * инструмента ДО zod-валидации.
 *
 * Root cause (по прод ToolCall.error): LLM зовёт инструменты именами
 * полей, которых нет в схеме (`due_date` вместо `date`, `description`
 * вместо `notes`/`request`) и относительными датами («сегодня»/«today»),
 * а строгая схема отвергает валидное по смыслу → действие молча не
 * происходит → бот «барахлит».
 *
 * Здесь: (1) alias-rename имён полей; (2) относительные даты → ISO.
 * ЧИСТАЯ, НИКОГДА не бросает. `resolveDate` инжектируется вызывающим
 * (он TZ-aware), поэтому функция тестируется без Date/сети/TZ.
 */

/** Ровно эти слова (после trim+lowercase) считаем относительной датой. */
const RELATIVE_DAYS: Record<string, number> = {
  сегодня: 0,
  завтра: 1,
  послезавтра: 2,
  вчера: -1,
  позавчера: -2,
  today: 0,
  tomorrow: 1,
  yesterday: -1,
};

/** offset в днях, если значение — РОВНО относительное слово; иначе undefined. */
function relOffset(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  return RELATIVE_DAYS[v.trim().toLowerCase()];
}

/**
 * Дешёвая проверка для chokepoint: есть ли в input хоть одно значение —
 * относительная дата (чтобы решать, тянуть ли TZ юзера).
 */
export function hasRelativeDate(rawInput: unknown): boolean {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return false;
  }
  try {
    for (const v of Object.values(rawInput as Record<string, unknown>)) {
      if (relOffset(v) !== undefined) return true;
    }
  } catch {
    /* defensive: никогда не бросаем */
  }
  return false;
}

export type NormalizeOpts = {
  /** alias имя поля → каноническое (напр. { due_date: 'date' }). */
  aliases?: Record<string, string>;
  /** offsetDays → ISO 'YYYY-MM-DD' (TZ-aware, инжектируется вызывающим). */
  resolveDate?: (offsetDays: number) => string;
};

/**
 * Нормализовать сырой вход инструмента: алиасы полей + относительные даты.
 * Не-объект → возвращается как есть. НИКОГДА не бросает.
 */
export function normalizeToolArgs(
  rawInput: unknown,
  opts: NormalizeOpts = {},
): unknown {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return rawInput;
  }
  try {
    const obj: Record<string, unknown> = {
      ...(rawInput as Record<string, unknown>),
    };

    // 1. Алиасы: alias → canonical. Не перезаписываем уже существующее
    //    каноническое поле; undefined-значение не двигаем; alias-ключ
    //    всегда убираем (это шум для строгой схемы).
    if (opts.aliases) {
      for (const [alias, canon] of Object.entries(opts.aliases)) {
        if (alias === canon) continue;
        if (alias in obj) {
          if (obj[alias] !== undefined && !(canon in obj)) {
            obj[canon] = obj[alias];
          }
          delete obj[alias];
        }
      }
    }

    // 2. Относительные даты → ISO (только значения-РОВНО-слово).
    if (opts.resolveDate) {
      for (const k of Object.keys(obj)) {
        const off = relOffset(obj[k]);
        if (off !== undefined) {
          try {
            obj[k] = opts.resolveDate(off);
          } catch {
            /* резолвер сбоит — оставляем исходное, не роняем */
          }
        }
      }
    }

    return obj;
  } catch {
    return rawInput;
  }
}
