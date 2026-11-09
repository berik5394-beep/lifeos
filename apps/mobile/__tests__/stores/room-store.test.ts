import { api } from '@/services/api';
import { useRoomStore } from '@/stores/room-store';

/** Комната: свободная расстановка, покупка за монеты, кладовка. */
const mockedApi = api as jest.Mocked<typeof api>;
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  useRoomStore.setState({ owned: [], items: [], catalog: [], coins: null, coinGain: null });
  useRoomStore.getState().reset();
  jest.clearAllMocks();
});

const SOFA = { id: 'a', itemKey: 'sofa', variantKey: 'budget:sofa', slot: null, surface: 'floor', x: 0.218, y: 0.27 } as const;
const DESK = { id: 'b', itemKey: 'desk', variantKey: 'budget:desk', slot: null, surface: 'floor', x: 0.907, y: 0.85 } as const;

describe('useRoomStore', () => {
  it('fetchRoom: мебель на поверхностях рисуется, кладовка — нет, неизвестные ключи отброшены', async () => {
    mockedApi.get.mockResolvedValueOnce({
      items: [SOFA, { id: 'c', itemKey: 'clock', variantKey: 'budget:clock', slot: null, surface: null }, { id: 'z', itemKey: 'rocket', variantKey: null, slot: null }],
    });
    await useRoomStore.getState().fetchRoom();
    expect(useRoomStore.getState().owned.map((o) => o.id)).toEqual(['a', 'c']);
    expect(useRoomStore.getState().items).toEqual([expect.objectContaining({ id: 'a', surface: 'floor', u: 0.218, v: 0.27 })]);
  });

  it('moveItem: куда отпустил — туда и встал (рядом с другим — можно), PUT { placements }', async () => {
    useRoomStore.setState({ owned: [SOFA, DESK] });
    mockedApi.put.mockResolvedValueOnce({ items: [{ ...SOFA, x: 0.9, y: 0.84 }, DESK] });
    useRoomStore.getState().moveItem('a', 'floor', 0.9, 0.84);
    expect(useRoomStore.getState().owned.find((o) => o.id === 'a')).toMatchObject({ surface: 'floor', x: 0.9, y: 0.84 });
    expect(useRoomStore.getState().owned.find((o) => o.id === 'b')).toMatchObject({ x: 0.907, y: 0.85 });
    await flush();
    expect(mockedApi.put).toHaveBeenCalledWith(
      '/room',
      { placements: [{ id: 'a', surface: 'floor', x: 0.9, y: 0.84 }] },
      expect.anything(),
      { queueOffline: false },
    );
  });

  it('сбой PUT → перечитываем комнату с сервера (там правда)', async () => {
    useRoomStore.setState({ owned: [SOFA] });
    mockedApi.put.mockRejectedValueOnce(new Error('500'));
    mockedApi.get.mockResolvedValueOnce({ items: [SOFA] });
    useRoomStore.getState().storeItem('a');
    expect(useRoomStore.getState().owned[0].surface).toBeNull();
    await flush();
    await flush();
    expect(useRoomStore.getState().owned[0].surface).toBe('floor');
  });

  it('placeFromStorage: на свободное привычное место; всё занято — всё равно в комнату (рядом)', () => {
    mockedApi.put.mockResolvedValue({ items: [] });
    useRoomStore.setState({ owned: [{ ...SOFA, surface: null }] });
    expect(useRoomStore.getState().placeFromStorage('a')).toBe(true);
    expect(useRoomStore.getState().owned[0]).toMatchObject({ surface: 'floor', x: 0.218, y: 0.27 });
    const full = [
      { s: 'wall-left', x: 0.401, y: 0.497 },
      { s: 'wall-back', x: 0.5, y: 0.167 },
      { s: 'wall-right', x: 0.599, y: 0.497 },
    ].map((p, i) => ({ id: `p${i}`, itemKey: 'picture' as const, variantKey: 'free:picture', slot: null, surface: p.s as 'wall-left', x: p.x, y: p.y }));
    useRoomStore.setState({ owned: [...full, { id: 'c', itemKey: 'clock', variantKey: 'budget:clock', slot: null, surface: null }] });
    expect(useRoomStore.getState().placeFromStorage('c')).toBe(true);
    expect(useRoomStore.getState().owned.find((o) => o.id === 'c')?.surface).toMatch(/^wall-/);
  });

  it('buy: успех — предмет в комнате, баланс с сервера; мебель никого не вытесняет', async () => {
    useRoomStore.setState({ owned: [SOFA], coins: 500 });
    const NEW = { id: 'n', itemKey: 'desk', variantKey: 'mid:desk', slot: 'floor-back-center', surface: 'floor', x: 0.5, y: 0.24 };
    mockedApi.post.mockResolvedValueOnce({ item: NEW, balance: 200 });
    mockedApi.get.mockResolvedValueOnce({ items: [SOFA, NEW] });
    const res = await useRoomStore.getState().buy('mid:desk');
    expect(res.ok).toBe(true);
    expect(mockedApi.post).toHaveBeenCalledWith('/room/buy', { variantKey: 'mid:desk' }, expect.anything(), { queueOffline: false });
    expect(useRoomStore.getState().coins).toBe(200);
    expect(useRoomStore.getState().items.map((i) => i.id).sort()).toEqual(['a', 'n']);
  });

  it('buy: не хватает монет → ошибка сервера юзеру, ничего не куплено', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('Не хватает 250 🪙 — выполняй дела, и монеты придут'));
    const res = await useRoomStore.getState().buy('mid:sofa');
    expect(res).toEqual({ ok: false, error: 'Не хватает 250 🪙 — выполняй дела, и монеты придут' });
    expect(useRoomStore.getState().owned).toEqual([]);
  });

  it('fetchCoins: рост баланса → всплывашка «+N»; первый показ — без неё', async () => {
    mockedApi.get.mockResolvedValueOnce({ balance: 200, recent: [] });
    await useRoomStore.getState().fetchCoins();
    expect(useRoomStore.getState().coinGain).toBeNull();
    mockedApi.get.mockResolvedValueOnce({ balance: 215, recent: [] });
    await useRoomStore.getState().fetchCoins();
    expect(useRoomStore.getState().coinGain).toMatchObject({ amount: 15 });
  });

  it('fetchCatalog грузит варианты один раз', async () => {
    mockedApi.get.mockResolvedValueOnce({
      variants: [{ key: 'mid:sofa', kind: 'sofa', tier: 'mid', label: 'Угловой диван', emoji: '🛋️', price: 400, spot: 'floor' }],
    });
    await useRoomStore.getState().fetchCatalog();
    await useRoomStore.getState().fetchCatalog();
    expect(mockedApi.get).toHaveBeenCalledTimes(1);
    expect(useRoomStore.getState().catalog).toHaveLength(1);
  });

  it('placeFromStorage для отделки: меняется с текущей (та — в кладовку)', () => {
    mockedApi.put.mockResolvedValue({ items: [] });
    useRoomStore.setState({
      owned: [
        { id: 'lux', itemKey: 'floor', variantKey: 'luxury:floor', slot: 'finish-floor' },
        { id: 'lin', itemKey: 'floor', variantKey: 'budget:floor', slot: null },
      ],
    });
    expect(useRoomStore.getState().placeFromStorage('lin')).toBe(true);
    const o = useRoomStore.getState().owned;
    expect(o.find((x) => x.id === 'lin')?.slot).toBe('finish-floor');
    expect(o.find((x) => x.id === 'lux')?.slot).toBeNull();
  });

  it('гонка: GET /room, начатый ДО перестановки, не откатывает её («отпрыгивание»)', async () => {
    useRoomStore.setState({ owned: [SOFA] });
    let resolveGet: (v: unknown) => void = () => {};
    mockedApi.get.mockImplementationOnce(() => new Promise((r) => (resolveGet = r)) as never);
    mockedApi.put.mockImplementationOnce(() => new Promise(() => {}) as never); // PUT ещё летит
    const fetching = useRoomStore.getState().fetchRoom();
    useRoomStore.getState().moveItem('a', 'floor', 0.116, 0.581);
    resolveGet({ items: [SOFA] });
    await fetching;
    expect(useRoomStore.getState().owned[0]).toMatchObject({ x: 0.116, y: 0.581 });
  });

  it('гонка: GET /coins, начатый ДО покупки, не возвращает старый баланс и не даёт ложное «+N»', async () => {
    useRoomStore.setState({ coins: 500 });
    let resolveCoins: (v: unknown) => void = () => {};
    mockedApi.get.mockImplementationOnce(() => new Promise((r) => (resolveCoins = r)) as never);
    const coinsReq = useRoomStore.getState().fetchCoins();
    mockedApi.post.mockResolvedValueOnce({ item: { id: 'n', itemKey: 'sofa', variantKey: 'mid:sofa', slot: 'floor-back-left' }, balance: 100 });
    mockedApi.get.mockResolvedValue({ items: [], balance: 100 });
    await useRoomStore.getState().buy('mid:sofa');
    resolveCoins({ balance: 500 });
    await coinsReq;
    expect(useRoomStore.getState().coins).toBe(100);
    expect(useRoomStore.getState().coinGain).toBeNull();
  });
});
