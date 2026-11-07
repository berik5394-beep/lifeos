import { isFriendship, levelTitle, nextLine, type Friendship } from '@/services/friendship';
import { shopState, type RoomVariant } from '@/services/room-catalog';

const levels = [
  { level: 1, title: 'Знакомые', at: 0 },
  { level: 2, title: 'Приятели', at: 50 },
  { level: 3, title: 'Друзья', at: 150 },
];
const f = (over: Partial<Friendship> = {}): Friendship => ({
  level: 2, title: 'Приятели', points: 110, next: levels[2], progress: 0.6, levels, levelUp: null, ...over,
});
const gift: RoomVariant = { key: 'friend:guitar', kind: 'guitar', tier: 'friend', label: 'Гитара', emoji: '🎸', price: 0, spot: 'floor', minLevel: 3 };

describe('робот-друг №4: уровень дружбы', () => {
  it('подписи уровня и пути до следующего', () => {
    expect(levelTitle(f(), 3)).toBe('Друзья');
    expect(levelTitle(null, 3)).toBe('уровень 3');
    expect(nextLine(f())).toBe('До «Друзья» — ещё 40');
    expect(nextLine(f({ next: null }))).toBe('Это самый высокий уровень дружбы');
  });

  it('ответ сервера проверяется', () => {
    expect(isFriendship(f())).toBe(true);
    expect(isFriendship({ level: 1 })).toBe(false);
    expect(isFriendship(null)).toBe(false);
  });

  it('подарок дружбы: закрыт до уровня, открыт — «взять», взятый — «есть»', () => {
    expect(shopState(gift, [], 0, 2)).toEqual({ kind: 'locked', minLevel: 3 });
    expect(shopState(gift, [], 0, null)).toEqual({ kind: 'locked', minLevel: 3 });
    expect(shopState(gift, [], 0, 3)).toEqual({ kind: 'buy' });
    expect(shopState(gift, [{ id: 'x', itemKey: 'guitar', variantKey: 'friend:guitar', slot: null }], 0, 3)).toEqual({ kind: 'owned' });
  });
});
