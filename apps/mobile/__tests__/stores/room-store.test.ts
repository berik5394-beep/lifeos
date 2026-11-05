import { api } from '@/services/api';
import { useRoomStore } from '@/stores/room-store';

/** Робот-эпик, Часть 6: комната на ячейках, покупка за монеты, кладовка. */
const mockedApi = api as jest.Mocked<typeof api>;
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  useRoomStore.setState({ owned: [], items: [], catalog: [], coins: null, coinGain: null });
  useRoomStore.getState().reset();
  jest.clearAllMocks();
});

const SOFA = { id: 'a', itemKey: 'sofa', variantKey: 'budget:sofa', slot: 'floor-back-left' } as const;
const DESK = { id: 'b', itemKey: 'desk', variantKey: 'budget:desk', slot: 'floor-front-right' } as const;

describe('useRoomStore', () => {
  it('fetchRoom: предметы в ячейках рисуются, кладовка — нет, неизвестные ключи отброшены', async () => {
    mockedApi.get.mockResolvedValueOnce({
      items: [SOFA, { id: 'c', itemKey: 'clock', variantKey: 'budget:clock', slot: null }, { id: 'z', itemKey: 'rocket', variantKey: null, slot: null }],
    });
    await useRoomStore.getState().fetchRoom();
    expect(useRoomStore.getState().owned.map((o) => o.id)).toEqual(['a', 'c']);
    expect(useRoomStore.getState().items).toEqual([expect.objectContaining({ id: 'a', x: 0.31, y: 0.64 })]);
  });

  it('moveItem в занятую ячейку → обмен сразу на экране и PUT { placements }', async () => {
    useRoomStore.setState({ owned: [SOFA, DESK] });
    mockedApi.put.mockResolvedValueOnce({ items: [{ ...SOFA, slot: 'floor-front-right' }, { ...DESK, slot: 'floor-back-left' }] });
    useRoomStore.getState().moveItem('a', 0.87, 0.9);
    expect(useRoomStore.getState().owned.find((o) => o.id === 'a')?.slot).toBe('floor-front-right');
    expect(useRoomStore.getState().owned.find((o) => o.id === 'b')?.slot).toBe('floor-back-left');
    await flush();
    expect(mockedApi.put).toHaveBeenCalledWith(
      '/room',
      { placements: [{ id: 'a', slot: 'floor-front-right' }, { id: 'b', slot: 'floor-back-left' }] },
      expect.anything(),
      { queueOffline: false },
    );
  });

  it('сбой PUT → перечитываем комнату с сервера (там правда)', async () => {
    useRoomStore.setState({ owned: [SOFA] });
    mockedApi.put.mockRejectedValueOnce(new Error('500'));
    mockedApi.get.mockResolvedValueOnce({ items: [SOFA] });
    useRoomStore.getState().storeItem('a');
    expect(useRoomStore.getState().owned[0].slot).toBeNull();
    await flush();
    await flush();
    expect(useRoomStore.getState().owned[0].slot).toBe('floor-back-left');
  });

  it('placeFromStorage: в первую свободную; мест нет → false', () => {
    mockedApi.put.mockResolvedValue({ items: [] });
    useRoomStore.setState({ owned: [{ ...SOFA, slot: null }] });
    expect(useRoomStore.getState().placeFromStorage('a')).toBe(true);
    expect(useRoomStore.getState().owned[0].slot).toBe('floor-back-left');
    const full = ['wall-left', 'wall-center', 'wall-right'].map((slot, i) => ({ id: `p${i}`, itemKey: 'picture' as const, variantKey: 'free:picture', slot: slot as 'wall-left' }));
    useRoomStore.setState({ owned: [...full, { id: 'c', itemKey: 'clock', variantKey: 'budget:clock', slot: null }] });
    expect(useRoomStore.getState().placeFromStorage('c')).toBe(false);
  });

  it('buy: успех — предмет в комнате, баланс с сервера; занятая ячейка уходит в кладовку', async () => {
    useRoomStore.setState({ owned: [SOFA], coins: 500 });
    mockedApi.post.mockResolvedValueOnce({ item: { id: 'n', itemKey: 'desk', variantKey: 'mid:desk', slot: 'floor-back-left' }, balance: 200 });
    mockedApi.get.mockResolvedValueOnce({ items: [{ ...SOFA, slot: null }, { id: 'n', itemKey: 'desk', variantKey: 'mid:desk', slot: 'floor-back-left' }] });
    const res = await useRoomStore.getState().buy('mid:desk');
    expect(res.ok).toBe(true);
    expect(mockedApi.post).toHaveBeenCalledWith('/room/buy', { variantKey: 'mid:desk' }, expect.anything(), { queueOffline: false });
    expect(useRoomStore.getState().coins).toBe(200);
    expect(useRoomStore.getState().owned.find((o) => o.id === 'a')?.slot).toBeNull();
    expect(useRoomStore.getState().items.map((i) => i.id)).toEqual(['n']);
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
    useRoomStore.getState().moveItem('a', 0.2, 0.76);
    resolveGet({ items: [SOFA] });
    await fetching;
    expect(useRoomStore.getState().owned[0].slot).toBe('floor-mid-left');
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
