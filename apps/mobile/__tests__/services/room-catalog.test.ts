import { ROOM_CATALOG, ROOM_MAX_ITEMS, clampToRoom, isRoomItemKey, roomItemEmoji } from '@/services/room-catalog';

describe('room-catalog — бесплатная мебель комнаты робота', () => {
  it('8 предметов, ключи совпадают с серверным каталогом', () => {
    expect(ROOM_CATALOG.map((i) => i.key)).toEqual(['plant', 'sofa', 'picture', 'lamp', 'books', 'clock', 'rug', 'plush']);
    expect(ROOM_MAX_ITEMS).toBe(30);
  });
  it('isRoomItemKey', () => {
    expect(isRoomItemKey('sofa')).toBe(true);
    expect(isRoomItemKey('rocket')).toBe(false);
  });
  it('clampToRoom держит предмет внутри комнаты 0..1', () => {
    expect(clampToRoom(-0.2, 1.4)).toEqual({ x: 0, y: 1 });
    expect(clampToRoom(0.3, 0.6)).toEqual({ x: 0.3, y: 0.6 });
  });
  it('roomItemEmoji: неизвестный ключ → пусто', () => {
    expect(roomItemEmoji('lamp')).toBe('💡');
    expect(roomItemEmoji('rocket')).toBe('');
  });
});
