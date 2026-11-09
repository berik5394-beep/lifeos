import {
  ROOM_CATALOG,
  SLOT_POS,
  applyPlacements,
  SLOT_SPOT,
  defaultSpot,
  finishTier,
  isPlaced,
  nearestSlot,
  placedItems,
  shopState,
  slotsFor,
  tierOf,
  type OwnedItem,
  type RoomVariant,
} from '@/services/room-catalog';

/** Комната: свободная расстановка мебели (2026-11-09); ячейки — только у отделки. */
const own = (id: string, itemKey: OwnedItem['itemKey'], slot: OwnedItem['slot'], variantKey = `budget:${itemKey}`): OwnedItem => ({
  id,
  itemKey,
  variantKey,
  slot,
});

describe('room-catalog — виды и ячейки', () => {
  it('19 видов: 10 платных + 4 бесплатных + 5 подарков дружбы; у каждого значок и падеж', () => {
    expect(ROOM_CATALOG).toHaveLength(19);
    for (const k of ROOM_CATALOG) {
      expect(k.emoji).toBeTruthy();
      expect(k.acc).toBeTruthy();
    }
  });
  it('стенное — только на стену, мебель — только на пол, отделка — не в ячейки', () => {
    expect(slotsFor('clock')).toEqual(['wall-left', 'wall-center', 'wall-right']);
    expect(slotsFor('sofa')).toHaveLength(7);
    expect(slotsFor('walls')).toEqual([]);
  });
  it('все ячейки внутри комнаты', () => {
    for (const p of Object.values(SLOT_POS)) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(1);
    }
  });
  it('nearestSlot учитывает совместимость: часы у пола всё равно на стену', () => {
    expect(nearestSlot('sofa', 0.12, 0.88)).toBe('floor-front-left');
    expect(nearestSlot('clock', 0.5, 0.55)).toBe('wall-center');
  });
  it('tierOf', () => {
    expect(tierOf('luxury:sofa')).toBe('luxury');
    expect(tierOf('free:plant')).toBe('free');
    expect(tierOf(null)).toBeNull();
  });
});

describe('свободная расстановка (каждый сам дизайнер)', () => {
  const at = (id: string, itemKey: OwnedItem['itemKey'], surface: 'floor' | 'wall-left' | 'wall-back' | 'wall-right', x: number, y: number): OwnedItem => ({
    ...own(id, itemKey, null),
    surface,
    x,
    y,
  });

  it('старые ячейки ↔ точки на поверхностях: та же точка экрана (зеркало сервера)', () => {
    for (const [slot, spot] of Object.entries(SLOT_SPOT)) {
      const [it] = placedItems([at('a', spot.surface === 'floor' ? 'sofa' : 'clock', spot.surface, spot.x, spot.y)]);
      const p = SLOT_POS[slot as keyof typeof SLOT_POS];
      expect(it.x).toBeCloseTo(p.x, 2);
      expect(it.y).toBeCloseTo(p.y, 2);
    }
  });

  it('applyPlacements: в любую точку, в кладовку и обратно; отделка — по ячейке', () => {
    const owned = [at('a', 'sofa', 'floor', 0.2, 0.3), own('w', 'walls', 'finish-walls')];
    const moved = applyPlacements(owned, [{ id: 'a', surface: 'floor', x: 0.61, y: 0.77 }]);
    expect(moved[0]).toMatchObject({ surface: 'floor', x: 0.61, y: 0.77 });
    const stored = applyPlacements(moved, [{ id: 'a', surface: null }, { id: 'w', slot: null }]);
    expect(stored.map(isPlaced)).toEqual([false, false]);
    expect(placedItems(stored)).toEqual([]);
  });

  it('defaultSpot: первое пустое привычное место; рядом стоит — следующее', () => {
    expect(defaultSpot([], 'clock')).toEqual(SLOT_SPOT['wall-center']);
    expect(defaultSpot([at('p', 'picture', 'wall-back', 0.52, 0.18)], 'clock')).toEqual(SLOT_SPOT['wall-left']);
    expect(defaultSpot([], 'walls')).toBeNull();
  });

  it('placedItems: кладовка и отделка не рисуются, у предмета есть поверхность и точка', () => {
    const items = placedItems([at('a', 'sofa', 'floor', 0.4, 0.5), own('s', 'desk', null), own('w', 'walls', 'finish-walls')]);
    expect(items).toEqual([expect.objectContaining({ id: 'a', surface: 'floor', u: 0.4, v: 0.5 })]);
  });
});

describe('отделка', () => {
  it('finishTier: отделка стен/пола задаёт вид комнаты', () => {
    expect(finishTier([own('w', 'walls', 'finish-walls', 'luxury:walls')], 'walls')).toBe('luxury');
    expect(finishTier([own('w', 'walls', null, 'luxury:walls')], 'walls')).toBeNull();
  });
});

describe('магазин: кнопка', () => {
  const v: RoomVariant = { key: 'mid:sofa', kind: 'sofa', tier: 'mid', label: 'Угловой диван', emoji: '🛋️', price: 400, spot: 'floor' };
  it('хватает → купить; не хватает → сколько; уже есть → есть; декор — всегда', () => {
    expect(shopState(v, [], 500)).toEqual({ kind: 'buy' });
    expect(shopState(v, [], 150)).toEqual({ kind: 'short', need: 250 });
    expect(shopState(v, [own('x', 'sofa', null, 'mid:sofa')], 5000)).toEqual({ kind: 'owned' });
    const free: RoomVariant = { ...v, key: 'free:plant', kind: 'plant', tier: 'free', price: 0 };
    expect(shopState(free, [own('p', 'plant', null, 'free:plant')], 0)).toEqual({ kind: 'buy' });
  });
});
