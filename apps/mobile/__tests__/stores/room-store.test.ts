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

  it('addItem ставит предмет в центр и сохраняет с задержкой', async () => {
    mockedApi.put.mockResolvedValue({ items: [] });
    expect(useRoomStore.getState().addItem('plant')).toBe(true);
    expect(useRoomStore.getState().items[0]).toMatchObject({ itemKey: 'plant', x: 0.5, y: 0.5 });
    expect(mockedApi.put).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(ROOM_SAVE_DELAY_MS);
    expect(mockedApi.put).toHaveBeenCalledTimes(1);
    expect(putBody()).toEqual([{ itemKey: 'plant', x: 0.5, y: 0.5 }]);
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

  it('сбой сети: изменения остаются локально, fetchRoom их не затирает', async () => {
    mockedApi.put.mockRejectedValueOnce(new Error('offline'));
    useRoomStore.getState().addItem('clock');
    await jest.advanceTimersByTimeAsync(ROOM_SAVE_DELAY_MS);
    expect(useRoomStore.getState().dirty).toBe(true);
    mockedApi.get.mockResolvedValueOnce({ items: [] });
    await useRoomStore.getState().fetchRoom();
    expect(useRoomStore.getState().items).toHaveLength(1);
  });
});
