import { normalizeHabit } from '../../tools/_habit-match.js';
import type { PersonType } from './types.js';

export interface PersonMeetingBrief {
  entityId: string;
  name: string;
  type?: PersonType;
  startTime: string; // 'HH:MM' локальное
  minutesUntil: number;
  daysSince: number;
  /** Первое открытое дело (любое направление) — для совместимости. */
  obligation?: string;
  /** Тебе должны деньгами (сумма открытых). */
  owed?: number;
  /** Ты должен деньгами (сумма открытых). */
  iOwe?: number;
  /** Твоё обещание этому человеку (дело, не деньги). */
  iPromised?: string;
  /** Что обещали тебе (дело, не деньги). */
  theyPromised?: string;
  /** Что помню о человеке — последняя запись памяти о нём. */
  remembered?: string;
  /** Название события в календаре. */
  eventTitle?: string;
  insightText?: string;
  deal?: string;
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

const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU').replace(/\u00a0/g, ' ')} ₸`;
const quote = (t: string, max = 90) => {
  const s = t.trim().replace(/\s+/g, ' ').replace(/[.!…]+$/u, '');
  return `«${s.length > max ? `${s.slice(0, max - 1)}…` : s}»`;
};

/**
 * Что важно знать перед встречей — фразами (Джарвис: «ты обещал ему прайс,
 * он должен тебе 200 000, в прошлый раз обсуждали турникеты»). Без рода:
 * пол человека и пользователя неизвестен. Только факты из БД.
 */
export function meetingBriefParts(b: PersonMeetingBrief): string[] {
  const out: string[] = [];
  if (b.iPromised) out.push(`Твоё обещание: ${quote(b.iPromised)}.`);
  if (b.theyPromised) out.push(`Обещали тебе: ${quote(b.theyPromised)}.`);
  if (!b.iPromised && !b.theyPromised && b.obligation) out.push(`Открыто: ${quote(b.obligation)}.`);
  if (b.owed && b.owed > 0) out.push(`Тебе должны ${money(b.owed)}.`);
  if (b.iOwe && b.iOwe > 0) out.push(`За тобой долг ${money(b.iOwe)}.`);
  if (b.deal) out.push(b.deal);
  if (b.remembered) out.push(`Помню: ${quote(b.remembered)}.`);
  return out;
}

/** Богатый бриф (облачко/инсайт): когда + кто + тип + каденс + факты. Чистый. */
export function describeMeetingBrief(b: PersonMeetingBrief): string {
  const label = b.type ? `[${TYPE_LABEL[b.type]}] ` : '';
  const when = b.minutesUntil <= 75 ? `через ~${b.minutesUntil} мин` : `сегодня в ${b.startTime}`;
  const head = `📅 ${when} — встреча с ${label}${b.name}. Последний контакт ${b.daysSince} дн.`;
  return [head, ...meetingBriefParts(b)].join(' ');
}

/** Текст пуша «через час встреча» с брифом; null — сказать нечего (обычное напоминание). */
export function meetingPushBody(b: PersonMeetingBrief): string | null {
  const parts = meetingBriefParts(b);
  if (parts.length === 0) return null;
  const who = b.type ? `${b.name} (${TYPE_LABEL[b.type]})` : b.name;
  return `${who}. ${parts.join(' ')}`;
}
