import { TOOL_HOME, isToolKey, toolSource, toolsInItem, TOOL_KEYS } from '@/services/room-tools';
import { ROOM_CATALOG, type RoomItem } from '@/services/room-catalog';

const item = (id: string, itemKey: RoomItem['itemKey'], x: number, y: number): RoomItem => ({ id, itemKey, x, y });

describe('room-tools — инструменты живут в мебели', () => {
  it('раскладка Berik: шкаф — календарь и цели, стол — задачи и сделки, тумбочка — дневник и привычки, комод — финансы', () => {
    expect(toolsInItem('wardrobe')).toEqual(['goals', 'calendar']);
    expect(toolsInItem('desk')).toEqual(['tasks', 'deals']);
    expect(toolsInItem('nightstand')).toEqual(['habits', 'journal']);
    expect(toolsInItem('dresser')).toEqual(['finance']);
    expect(toolsInItem('clock')).toEqual(['today']);
    expect(toolsInItem('sofa')).toEqual([]);
  });
  it('каждый инструмент лежит в предмете из каталога', () => {
    const keys = new Set(ROOM_CATALOG.map((i) => i.key));
    for (const t of TOOL_KEYS) expect(keys.has(TOOL_HOME[t])).toBe(true);
  });
  it('нет нужной мебели → null («из воздуха»)', () => {
    expect(toolSource('tasks', [item('a', 'sofa', 0.5, 0.8)], { x: 0.5, y: 0.9 })).toBeNull();
  });
  it('несколько шкафов → ближайший к роботу', () => {
    const items = [item('far', 'wardrobe', 0.1, 0.4), item('near', 'wardrobe', 0.8, 0.85)];
    expect(toolSource('calendar', items, { x: 0.7, y: 0.9 })?.id).toBe('near');
  });
  it('isToolKey', () => {
    expect(isToolKey('tasks')).toBe(true);
    expect(isToolKey('deals')).toBe(true);
    expect(isToolKey('rocket')).toBe(false);
    expect(isToolKey(null)).toBe(false);
  });
});
