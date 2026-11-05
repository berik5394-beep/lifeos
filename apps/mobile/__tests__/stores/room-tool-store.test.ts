import { useRoomToolStore } from '@/stores/room-tool-store';

beforeEach(() => useRoomToolStore.setState({ requested: null, seq: 0 }));

describe('room-tool-store — запрос «достань инструмент»', () => {
  it('openTool кладёт запрос, take забирает его один раз', () => {
    expect(useRoomToolStore.getState().openTool('calendar')).toBe(true);
    expect(useRoomToolStore.getState().take()).toBe('calendar');
    expect(useRoomToolStore.getState().take()).toBeNull();
  });
  it('неизвестный инструмент игнорируется', () => {
    expect(useRoomToolStore.getState().openTool('rocket')).toBe(false);
    expect(useRoomToolStore.getState().requested).toBeNull();
  });
  it('повторный запрос того же инструмента меняет seq (сцена проиграется снова)', () => {
    useRoomToolStore.getState().openTool('tasks');
    const s1 = useRoomToolStore.getState().seq;
    useRoomToolStore.getState().openTool('tasks');
    expect(useRoomToolStore.getState().seq).toBe(s1 + 1);
  });
});
