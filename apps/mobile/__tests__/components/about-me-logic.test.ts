import { factsAbout, groupFacts, mentionedAgo, isEmpty, type AboutMe, type AboutMeFact } from '@/components/memory/about-me-logic';

const f = (id: string, type: string, content: string, entityRefs: string[] = []): AboutMeFact => ({
  id, type, content, importance: 5, createdAt: '2026-11-01T10:00:00.000Z', entityRefs,
});

describe('«Что я о тебе помню» — логика экрана', () => {
  const data: AboutMe = {
    people: [{ id: 'e1', name: 'Мама', facts: ['семья'], relations: [], importance: 9, lastMentioned: '2026-11-05' }],
    facts: [
      f('m1', 'preference', 'Любит кофе без сахара'),
      f('m2', 'person', 'Мама любит пионы'),
      f('m3', 'person', 'Серик переехал в Астану'),
      f('m4', 'decision', 'Решил копить на квартиру'),
      f('m5', 'emotion', 'Переживает из-за работы'),
      f('m6', 'event', 'Встреча с Аскаром', ['e1']),
    ],
  };

  it('воспоминания про человека: по ссылке или по имени в тексте', () => {
    expect(factsAbout(data.people[0], data.facts).map((x) => x.id)).toEqual(['m2', 'm6']);
  });

  it('разделы: о тебе / про людей (без уже показанных у человека) / решения и события / что волновало', () => {
    const s = groupFacts(data);
    expect(s.map((x) => [x.title, x.facts.map((y) => y.id)])).toEqual([
      ['О тебе', ['m1']],
      ['Про людей', ['m3']],
      ['Решения и события', ['m4', 'm6']],
      ['Что тебя волновало', ['m5']],
    ]);
  });

  it('«когда упоминал» по-человечески', () => {
    expect(mentionedAgo('2026-11-07', '2026-11-07')).toBe('сегодня');
    expect(mentionedAgo('2026-11-06', '2026-11-07')).toBe('вчера');
    expect(mentionedAgo('2026-11-02', '2026-11-07')).toBe('5 дн. назад');
    expect(mentionedAgo('2026-10-20', '2026-11-07')).toBe('2 нед. назад');
    expect(mentionedAgo('2026-06-12T08:00:00.000Z', '2026-11-07')).toBe('12 июн');
  });

  it('пусто — показываем приглашение рассказать о себе', () => {
    expect(isEmpty({ people: [], facts: [] })).toBe(true);
    expect(isEmpty(data)).toBe(false);
  });
});
