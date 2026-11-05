import {
  ROOM_CATALOG,
  SLOT_POS,
  applyPlacements,
  finishTier,
  firstFreeSlot,
  nearestSlot,
  placedItems,
  planDrop,
  shopState,
  slotsFor,
  tierOf,
  type OwnedItem,
  type RoomVariant,
} from '@/services/room-catalog';

/** Робот-эпик, Часть 6: ячейки вместо свободных координат — предметы не накладываются. */
const own = (id: string, itemKey: OwnedItem['itemKey'], slot: OwnedItem['slot'], variantKey = `budget:${itemKey}`): OwnedItem => ({
  id,
  itemKey,
  variantKey,
  slot,
});

describe('room-catalog — виды и ячейки', () => {
  it('14 видов: 10 платных + 4 бесплатных; у каждого значок и падеж', () => {
    expect(ROOM_CATALOG).toHaveLength(14);
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

describe('защёлкивание и обмен', () => {
  const owned = [own('a', 'sofa', 'floor-back-left'), own('b', 'desk', 'floor-front-right'), own('c', 'clock', 'wall-left')];

  it('в свободную ячейку — один перенос', () => {
    expect(planDrop(owned, 'a', 0.2, 0.76)).toEqual([{ id: 'a', slot: 'floor-mid-left' }]);
  });
  it('в занятую — обмен местами', () => {
    expect(planDrop(owned, 'a', 0.87, 0.9)).toEqual([
      { id: 'a', slot: 'floor-front-right' },
      { id: 'b', slot: 'floor-back-left' },
    ]);
  });
  it('отпустил на своём месте — ничего', () => {
    expect(planDrop(owned, 'a', 0.31, 0.64)).toEqual([]);
  });
  it('applyPlacements + placedItems: координаты из ячейки, кладовка не рисуется', () => {
    const next = applyPlacements(owned, [{ id: 'c', slot: null }]);
    const items = placedItems(next);
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(items[0]).toMatchObject({ x: SLOT_POS['floor-back-left'].x, y: SLOT_POS['floor-back-left'].y });
  });
  it('firstFreeSlot: из кладовки в первую свободную подходящую', () => {
    expect(firstFreeSlot(owned, 'picture')).toBe('wall-center');
  });
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
