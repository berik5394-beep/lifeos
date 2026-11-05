import { api } from '@/services/api';
import { useRoomStore, ROOM_SAVE_DELAY_MS } from '@/stores/room-store';

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.useFakeTimers();
  useRoomStore.setState({ items: [], dirty: false });
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
});

const putBody = (call = 0) => (mockedApi.put.mock.calls[call][1] as { items: unknown[] }).items;

describe('useRoomStore — расстановка мебели', () => {
  it('fetchRoom загружает расстановку с сервера', async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [{ id: 'a', itemKey: 'sofa', x: 0.2, y: 0.7 }] });
    await useRoomStore.getState().fetchRoom();
    expect(mockedApi.get).toHaveBeenCalledWith('/room', expect.anything());
    expect(useRoomStore.getState().items).toEqual([{ id: 'a', itemKey: 'sofa', x: 0.2, y: 0.7 }]);
  });

  it('addItem ставит предмет около центра и сохраняет с задержкой', async () => {
    mockedApi.put.mockResolvedValue({ items: [] });
    expect(useRoomStore.getState().addItem('plant')).toBe(true);
    const it0 = useRoomStore.getState().items[0];
    expect(it0.itemKey).toBe('plant');
    expect(Math.abs(it0.x - 0.5)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(it0.y - 0.5)).toBeLessThanOrEqual(0.1);
    expect(mockedApi.put).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(ROOM_SAVE_DELAY_MS);
    expect(mockedApi.put).toHaveBeenCalledTimes(1);
    expect(putBody()).toEqual([{ itemKey: 'plant', x: it0.x, y: it0.y }]);
  });

  it('серия движений → один PUT с последней позицией', async () => {
    mockedApi.put.mockResolvedValue({ items: [] });
    useRoomStore.setState({ items: [{ id: 'a', itemKey: 'sofa', x: 0.2, y: 0.7 }] });
    for (let i = 1; i <= 10; i++) {
      useRoomStore.getState().moveItem('a', i / 20, 0.5);
      await jest.advanceTimersByTimeAsync(50);
    }
    await jest.advanceTimersByTimeAsync(ROOM_SAVE_DELAY_MS);
    expect(mockedApi.put).toHaveBeenCalledTimes(1);
    expect(putBody()).toEqual([{ itemKey: 'sofa', x: 0.5, y: 0.5 }]);
  });

  it('moveItem не выпускает предмет за пределы комнаты', () => {
    useRoomStore.setState({ items: [{ id: 'a', itemKey: 'sofa', x: 0.2, y: 0.7 }] });
    useRoomStore.getState().moveItem('a', 1.3, -0.1);
    expect(useRoomStore.getState().items[0]).toMatchObject({ x: 1, y: 0 });
  });

  it('removeItem убирает предмет и сохраняет', async () => {
    mockedApi.put.mockResolvedValue({ items: [] });
    useRoomStore.setState({ items: [{ id: 'a', itemKey: 'sofa', x: 0.2, y: 0.7 }, { id: 'b', itemKey: 'lamp', x: 0.6, y: 0.4 }] });
    useRoomStore.getState().removeItem('a');
    await jest.advanceTimersByTimeAsync(ROOM_SAVE_DELAY_MS);
    expect(putBody()).toEqual([{ itemKey: 'lamp', x: 0.6, y: 0.4 }]);
  });

  it('больше 30 предметов поставить нельзя', () => {
    useRoomStore.setState({ items: Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, itemKey: 'books' as const, x: 0.1, y: 0.1 })) });
    expect(useRoomStore.getState().addItem('plant')).toBe(false);
    expect(useRoomStore.getState().items).toHaveLength(30);
  });

  it('сбой сети: правки остаются, fetchRoom их не затирает и досылает', async () => {
    mockedApi.put.mockRejectedValueOnce(new Error('offline'));
    useRoomStore.getState().addItem('clock');
    await jest.advanceTimersByTimeAsync(ROOM_SAVE_DELAY_MS);
    expect(useRoomStore.getState().dirty).toBe(true);
    mockedApi.get.mockResolvedValueOnce({ items: [] });
    mockedApi.put.mockResolvedValueOnce({ items: [] });
    await useRoomStore.getState().fetchRoom();
    expect(useRoomStore.getState().items).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(ROOM_SAVE_DELAY_MS);
    expect(mockedApi.put).toHaveBeenCalledTimes(2);
    expect(useRoomStore.getState().dirty).toBe(false);
  });

  it('сохранения по очереди: новое не уходит, пока летит прежнее', async () => {
    let release: () => void = () => {};
    mockedApi.put.mockImplementationOnce(() => new Promise((r) => { release = () => r({ items: [] }); }));
    mockedApi.put.mockResolvedValue({ items: [] });
    useRoomStore.setState({ items: [{ id: 'a', itemKey: 'sofa', x: 0.2, y: 0.7 }] });
    useRoomStore.getState().moveItem('a', 0.3, 0.7);
    await jest.advanceTimersByTimeAsync(ROOM_SAVE_DELAY_MS);
    expect(mockedApi.put).toHaveBeenCalledTimes(1);
    useRoomStore.getState().moveItem('a', 0.9, 0.7);
    await jest.advanceTimersByTimeAsync(ROOM_SAVE_DELAY_MS * 3);
    expect(mockedApi.put).toHaveBeenCalledTimes(1); // ждёт первый
    release();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockedApi.put).toHaveBeenCalledTimes(2);
    expect(putBody(1)).toEqual([{ itemKey: 'sofa', x: 0.9, y: 0.7 }]);
    expect(useRoomStore.getState().dirty).toBe(false);
  });

  it('reset (выход из аккаунта): комната пустая, отложенное сохранение отменено', async () => {
    useRoomStore.getState().addItem('lamp');
    useRoomStore.getState().reset();
    await jest.advanceTimersByTimeAsync(ROOM_SAVE_DELAY_MS * 2);
    expect(useRoomStore.getState().items).toEqual([]);
    expect(useRoomStore.getState().dirty).toBe(false);
    expect(mockedApi.put).not.toHaveBeenCalled();
  });
});
