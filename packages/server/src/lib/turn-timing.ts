/**
 * Замер хода робота по шагам (jarvis-roadmap №5 «ускорить начало»): сколько мс
 * от начала хода до разбора намерения, контекста, подготовки промпта, первого
 * слова агента и конца. Одна строка в лог `[jarvis:timing]` — по ней видно, что
 * тормозит на проде. Ничего не меняет в ответе.
 */
export interface TurnTiming {
  mark: (name: string) => void;
  /** Первый кусок текста агента (только первый вызов считается). */
  firstToken: () => void;
  line: (extra?: Record<string, string | number>) => string;
}

export function createTurnTiming(now: () => number = Date.now): TurnTiming {
  const start = now();
  const marks: Array<[string, number]> = [];
  let first: number | null = null;
  return {
    mark: (name) => {
      marks.push([name, now() - start]);
    },
    firstToken: () => {
      if (first === null) first = now() - start;
    },
    line: (extra = {}) => {
      const parts = marks.map(([k, v]) => `${k}=${v}`);
      if (first !== null) parts.push(`first=${first}`);
      parts.push(`total=${now() - start}`);
      for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${v}`);
      return `[jarvis:timing] ${parts.join(' ')}`;
    },
  };
}
