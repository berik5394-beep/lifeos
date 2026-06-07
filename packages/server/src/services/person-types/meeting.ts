import { normalizeHabit } from '../../tools/_habit-match.js';
import type { PersonType } from './types.js';

export interface PersonMeetingBrief {
  entityId: string;
  name: string;
  type?: PersonType;
  startTime: string; // 'HH:MM' локальное
  minutesUntil: number;
  daysSince: number;
  obligation?: string;
  owed?: number;
  insightText?: string;
}

const TYPE_LABEL: Record<PersonType, string> = {
  client: 'клиент', investor: 'инвестор', partner: 'партнёр', family: 'семья', friend: 'друг',
};

/**
 * Консервативный матч человека в тексте события (D2): нормализованный токен
 * события === токену имени/алиаса ИЛИ начинается с него (склонение Серик→
 * «сериком»). Мин. длина норм-токена 3 (шум коротких имён). БЕЗ Левенштейна
 * (ложный бриф про не того хуже пропуска).
 */
export function matchPersonInText(name: string, aliases: string[], text: string): boolean {
  const eventTokens = normalizeHabit(text).split(' ').filter((t) => t.length >= 3);
  if (eventTokens.length === 0) return false;
  const nameTokens = [name, ...aliases]
    .flatMap((c) => normalizeHabit(c).split(' '))
    .filter((t) => t.length >= 3);
  for (const nt of nameTokens) {
    for (const et of eventTokens) {
      if (et === nt || et.startsWith(nt)) return true;
    }
  }
  return false;
}

/** Минут до начала события сегодня (отрицательное = уже прошло). 'HH:MM' локальные. */
export function minutesUntil(nowHHMM: string, startHHMM: string): number {
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  return toMin(startHHMM) - toMin(nowHHMM);
}

/** Богатый бриф: тип + каденс + открытое дело + долг тебе. Чистый. */
export function describeMeetingBrief(b: PersonMeetingBrief): string {
  const label = b.type ? `[${TYPE_LABEL[b.type]}] ` : '';
  const when = b.minutesUntil <= 75 ? `через ~${b.minutesUntil} мин` : `сегодня в ${b.startTime}`;
  let s = `📅 ${when} — встреча с ${label}${b.name}. Последний контакт ${b.daysSince} дн.`;
  if (b.obligation) s += ` Открыто: «${b.obligation}».`;
  if (b.owed && b.owed > 0) s += ` Должен тебе ${b.owed}₸.`;
  return s;
}
