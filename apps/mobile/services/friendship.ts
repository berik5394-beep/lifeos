/**
 * Робот-друг №4: уровень дружбы (SSOT — сервер, GET /robot/friendship).
 * Здесь — тип ответа и чистые подписи для экрана.
 */
export interface FriendshipLevel {
  level: number;
  title: string;
  at: number;
}

export interface Friendship {
  level: number;
  title: string;
  points: number;
  next: FriendshipLevel | null;
  /** 0..1 — путь до следующего уровня. */
  progress: number;
  levels: FriendshipLevel[];
  /** Фраза робота о новом уровне — приходит один раз. */
  levelUp: string | null;
}

export function levelTitle(f: Pick<Friendship, 'levels'> | null, level: number): string {
  return f?.levels.find((l) => l.level === level)?.title ?? `уровень ${level}`;
}

/** «До «Друзья» — ещё 40» / самый высокий уровень. */
export function nextLine(f: Friendship): string {
  if (!f.next) return 'Это самый высокий уровень дружбы';
  return `До «${f.next.title}» — ещё ${Math.max(0, f.next.at - f.points)}`;
}

export function isFriendship(x: unknown): x is Friendship {
  const f = x as Friendship | null;
  return !!f && typeof f.level === 'number' && typeof f.title === 'string' && Array.isArray(f.levels);
}
