/**
 * Умный матч привычки по имени (рус. морфология). Чистый, юнит-тестируемый.
 * Тяжёлые семантические случаи НЕ матчатся → null → честный not-found+список.
 */

// Хвостовые окончания, отсортированы длинными вперёд (срезаем самое длинное).
const ENDINGS = ['ого', 'его', 'ами', 'ями', 'ую', 'юю', 'ах', 'ях', 'ой', 'ою', 'а', 'я', 'ы', 'и', 'е', 'о', 'у', 'ю'];

export function normalizeHabit(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(token: string): string {
  for (const e of ENDINGS) {
    if (token.length - e.length >= 3 && token.endsWith(e)) {
      return token.slice(0, -e.length);
    }
  }
  return token;
}

function stemJoined(s: string): string {
  return stem(normalizeHabit(s).replace(/\s+/g, ''));
}

function stemTokens(s: string): string[] {
  return normalizeHabit(s).split(' ').filter(Boolean).map(stem);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export interface HabitRef {
  id: string;
  name: string;
}

export function matchHabit(query: string, habits: HabitRef[]): HabitRef | null {
  const nq = normalizeHabit(query);
  if (!nq || habits.length === 0) return null;
  const sq = stemJoined(query);
  const qt = stemTokens(query);

  const scored = habits
    .map((h) => {
      const nn = normalizeHabit(h.name);
      const sn = stemJoined(h.name);
      let tier = 99;
      let dist = 999;
      if (nn === nq) {
        tier = 0;
        dist = 0;
      } else if (sn === sq) {
        tier = 1;
        dist = 0;
      } else if (sn.length >= 3 && sq.length >= 3 && (sn.includes(sq) || sq.includes(sn))) {
        tier = 2;
        dist = Math.abs(sn.length - sq.length);
      } else if (qt.some((t) => t.length >= 3 && stemTokens(h.name).includes(t))) {
        tier = 3;
        dist = 0;
      } else {
        const d = levenshtein(sq, sn);
        const thr = Math.max(1, Math.floor(Math.max(sq.length, sn.length) / 4));
        if (d <= thr) {
          tier = 4;
          dist = d;
        }
      }
      return { h, tier, dist };
    })
    .filter((c) => c.tier < 99)
    .sort((a, b) => a.tier - b.tier || a.dist - b.dist);

  if (scored.length === 0) return null;
  // Неоднозначность: топ-2 на одном СЛАБОМ тире (≥2: contains/токен/fuzzy) →
  // не угадываем, честно переспросим. Тиры 0/1 (точное/стем-точное) однозначны.
  if (scored.length >= 2 && scored[0].tier === scored[1].tier && scored[0].tier >= 2) {
    return null;
  }
  return { id: scored[0].h.id, name: scored[0].h.name };
}

export function buildNotFoundMessage(query: string, habits: HabitRef[]): string {
  if (habits.length === 0) {
    return `Не нашёл привычку «${query}» — у тебя пока нет привычек. Хочешь завести?`;
  }
  const list = habits.map((h) => h.name).join(', ');
  return `Не нашёл привычку «${query}». Сейчас у тебя: ${list}. Какую отметить?`;
}
