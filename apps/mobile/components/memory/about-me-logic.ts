/** «Что я о тебе помню» — чистая логика экрана (группировка, связи, «когда»). */

export interface AboutMePerson {
  id: string;
  name: string;
  facts: string[];
  relations: string[];
  importance: number;
  lastMentioned: string; // YYYY-MM-DD
}

export interface AboutMeFact {
  id: string;
  type: string;
  content: string;
  importance: number;
  createdAt: string;
  entityRefs: string[];
}

export interface AboutMe {
  people: AboutMePerson[];
  facts: AboutMeFact[];
}

export interface FactSection {
  key: string;
  title: string;
  facts: AboutMeFact[];
}

const SECTIONS: { key: string; title: string; types: string[] }[] = [
  { key: 'you', title: 'О тебе', types: ['fact', 'preference', 'place'] },
  { key: 'people', title: 'Про людей', types: ['person'] },
  { key: 'moments', title: 'Решения и события', types: ['decision', 'event'] },
  { key: 'feelings', title: 'Что тебя волновало', types: ['emotion'] },
];

/** Воспоминания про конкретного человека: ссылка на него или имя в тексте. */
export function factsAbout(person: Pick<AboutMePerson, 'id' | 'name'>, facts: AboutMeFact[]): AboutMeFact[] {
  const name = person.name.trim().toLowerCase();
  return facts.filter((f) => f.entityRefs.includes(person.id) || (name.length >= 3 && f.content.toLowerCase().includes(name)));
}

/**
 * Разделы фактов. Воспоминания, уже показанные внутри карточки человека,
 * в «Про людей» не дублируем. Пустые разделы не показываем.
 */
export function groupFacts(data: AboutMe): FactSection[] {
  const shownWithPeople = new Set(data.people.flatMap((p) => factsAbout(p, data.facts).map((f) => f.id)));
  return SECTIONS.map((s) => ({
    key: s.key,
    title: s.title,
    facts: data.facts.filter((f) => s.types.includes(f.type) && !(s.key === 'people' && shownWithPeople.has(f.id))),
  })).filter((s) => s.facts.length > 0);
}

/** «сегодня», «вчера», «3 дн. назад», «2 нед. назад», «12 ноя». */
export function mentionedAgo(dateYmd: string, today: string): string {
  const d = Date.parse(dateYmd.slice(0, 10) + 'T00:00:00Z');
  const t = Date.parse(today + 'T00:00:00Z');
  const days = Math.round((t - d) / 86_400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 14) return `${days} дн. назад`;
  if (days < 60) return `${Math.floor(days / 7)} нед. назад`;
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const [, m, dd] = dateYmd.slice(0, 10).split('-').map(Number);
  return `${dd} ${MONTHS[(m || 1) - 1]}`;
}

export function isEmpty(data: AboutMe | null): boolean {
  return !data || (data.people.length === 0 && data.facts.length === 0);
}
