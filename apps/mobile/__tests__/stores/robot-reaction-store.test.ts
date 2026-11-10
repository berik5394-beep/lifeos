import { api } from '@/services/api';
import { useFinanceStore } from '@/stores/finance-store';
import { useTaskStore } from '@/stores/task-store';
import { useHabitStore } from '@/stores/habit-store';
import { useGoalStore } from '@/stores/goal-store';
import { budgetReactionText, useRobotReactionStore } from '@/stores/robot-reaction-store';

const mockApi = api as jest.Mocked<typeof api>;

const EXPENSE = {
  id: 'exp-1',
  userId: 'user-1',
  date: '2026-11-08',
  category: 'food',
  description: 'Обед',
  amount: 6000,
  createdAt: '2026-11-08T12:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  useRobotReactionStore.setState({ reaction: null });
  useFinanceStore.setState({ expenses: [] });
});

describe('budgetReactionText', () => {
  it('молчит без предупреждения сервера', () => {
    expect(budgetReactionText('food', undefined)).toBeNull();
    expect(budgetReactionText('food', { limit: 50000, spent: 10000, percentage: 20 })).toBeNull();
  });

  it('≥80%: процент и остаток, категория по-русски', () => {
    const t = budgetReactionText('food', { limit: 50000, spent: 42500, percentage: 85, warning: 'x' });
    expect(t).toBe('На «Еда» ушло 85% лимита — осталось 7 500 ₸.');
  });

  it('≥100%: превышен, сколько из скольких', () => {
    const t = budgetReactionText('transport', { limit: 20000, spent: 26000, percentage: 130, warning: 'x' });
    expect(t).toBe('Лимит на «Транспорт» превышен: 26 000 ₸ из 20 000 ₸.');
  });
});

describe('реакция робота на действия с экрана', () => {
  it('трата сверх лимита → тревога + облачко; budgetInfo не попадает в список', async () => {
    mockApi.post.mockResolvedValueOnce({
      ...EXPENSE,
      budgetInfo: { limit: 50000, spent: 56000, percentage: 112, warning: 'Лимит превышен' },
    });
    await useFinanceStore.getState().createExpense({
      date: '2026-11-08',
      category: 'food',
      description: 'Обед',
      amount: 6000,
    });
    const r = useRobotReactionStore.getState().reaction;
    expect(r?.emotion).toBe('worried');
    expect(r?.text).toContain('превышен');
    expect(useFinanceStore.getState().expenses[0]).toEqual(EXPENSE);
  });

  it('трата в рамках лимита → робот молчит', async () => {
    mockApi.post.mockResolvedValueOnce({ ...EXPENSE, budgetInfo: { limit: 50000, spent: 6000, percentage: 12 } });
    await useFinanceStore.getState().createExpense({ date: '2026-11-08', category: 'food', description: 'Обед', amount: 6000 });
    expect(useRobotReactionStore.getState().reaction).toBeNull();
  });

  it('закрыл задачу → радость; снял галочку → нет', async () => {
    const task = { id: 't1', title: 'Отчёт', completed: false } as never;
    useTaskStore.setState({ tasks: [task] });
    mockApi.patch.mockResolvedValueOnce({ id: 't1', title: 'Отчёт', completed: true });
    await useTaskStore.getState().toggleComplete('t1');
    expect(useRobotReactionStore.getState().reaction?.emotion).toBe('happy');

    useRobotReactionStore.setState({ reaction: null });
    mockApi.patch.mockResolvedValueOnce({ id: 't1', title: 'Отчёт', completed: false });
    await useTaskStore.getState().toggleComplete('t1');
    expect(useRobotReactionStore.getState().reaction).toBeNull();
  });

  it('отметил привычку → радость', async () => {
    mockApi.post.mockResolvedValueOnce({ id: 'l1', habitId: 'h1', userId: 'u', date: '2026-11-08', completed: true, autoCompleted: false });
    await useHabitStore.getState().toggleHabitLog('h1', '2026-11-08', true);
    expect(useRobotReactionStore.getState().reaction?.emotion).toBe('happy');
  });
});

describe('разбор цели после постановки с экрана', () => {
  const GOAL = { id: 'g1', userId: 'u', year: 2026, area: 'finance', goalText: 'Миллион', progress: 0 };

  it('цель сохраняется сразу, разбор приходит облачком «thinking» и держится дольше', async () => {
    useGoalStore.setState({ yearlyGoals: [] });
    mockApi.post
      .mockResolvedValueOnce(GOAL)
      .mockResolvedValueOnce({ text: 'Про цель «Миллион»:\nЭто 100 000 ₸ в месяц…' });
    await useGoalStore.getState().createYearlyGoal({ year: 2026, area: 'finance', goalText: 'Миллион' });
    expect(useGoalStore.getState().yearlyGoals).toHaveLength(1);
    expect(mockApi.post).toHaveBeenLastCalledWith('/goals/yearly/g1/intake', {}, 'test-token-123');
    await new Promise((r) => setImmediate(r));
    const r = useRobotReactionStore.getState().reaction;
    expect(r?.emotion).toBe('thinking');
    expect(r?.text).toContain('Про цель «Миллион»');
    expect(r?.holdMs).toBeGreaterThan(9000);
  });

  it('разбора нет (флаг выкл.) или сбой — робот молчит, цель сохранена', async () => {
    useGoalStore.setState({ yearlyGoals: [] });
    mockApi.post.mockResolvedValueOnce(GOAL).mockRejectedValueOnce(new Error('сеть'));
    await useGoalStore.getState().createYearlyGoal({ year: 2026, area: 'finance', goalText: 'Миллион' });
    await new Promise((r) => setImmediate(r));
    expect(useGoalStore.getState().yearlyGoals).toHaveLength(1);
    expect(useRobotReactionStore.getState().reaction).toBeNull();
  });
});

import { useEventStore } from '@/stores/event-store';
describe('наложение по времени с экрана', () => {
  it('задача поверх встречи → тревога + текст сервера; conflictWarning не попадает в список', async () => {
    useTaskStore.setState({ tasks: [] });
    mockApi.post.mockResolvedValueOnce({ id: 't9', title: 'Позвонить', completed: false, conflictWarning: 'Накладывается на время с встречей «Планёрка» 10:00–11:00.' });
    await useTaskStore.getState().createTask({ title: 'Позвонить', category: 'work', priority: 'medium', date: '2026-12-01', time: '10:30' } as never);
    const r = useRobotReactionStore.getState().reaction;
    expect(r?.emotion).toBe('worried');
    expect(r?.text).toContain('Планёрка');
    expect(useTaskStore.getState().tasks[0]).not.toHaveProperty('conflictWarning');
  });

  it('встреча поверх задачи → тревога; без наложения — молчит', async () => {
    useEventStore.setState({ events: [] } as never);
    mockApi.post.mockResolvedValueOnce({ id: 'e1', title: 'Встреча', date: '2026-12-01', conflictWarning: 'Накладывается на время с задачей «Отчёт» в 14:15.' });
    await useEventStore.getState().createEvent({ title: 'Встреча', date: '2026-12-01', startTime: '14:00', endTime: '15:00' } as never);
    expect(useRobotReactionStore.getState().reaction?.text).toContain('Отчёт');

    useRobotReactionStore.setState({ reaction: null });
    mockApi.post.mockResolvedValueOnce({ id: 'e2', title: 'Обед', date: '2026-12-01' });
    await useEventStore.getState().createEvent({ title: 'Обед', date: '2026-12-01', startTime: '13:00' } as never);
    expect(useRobotReactionStore.getState().reaction).toBeNull();
  });
});

describe('быстрая строка задачи со временем', () => {
  it('сервер нашёл наложение → облачко', async () => {
    useTaskStore.setState({ tasks: [] });
    mockApi.post.mockResolvedValueOnce({
      task: { id: 't10', title: 'Позвонить', completed: false },
      conflictWarning: 'Накладывается на время с встречей «Планёрка» 10:00–11:00.',
    });
    await useTaskStore.getState().quickAdd('позвонить завтра в 10:30');
    expect(useRobotReactionStore.getState().reaction?.text).toContain('Планёрка');
    expect(useTaskStore.getState().tasks[0]).toEqual({ id: 't10', title: 'Позвонить', completed: false });
  });
});

import { useChatStore } from '@/stores/chat-store';
describe('перегруз дня и наложение сразу', () => {
  it('одно облачко: наложение первой строкой предложения, кнопка «Подтвердить» сохранена', async () => {
    useTaskStore.setState({ tasks: [] });
    useChatStore.setState({ messages: [] } as never);
    mockApi.post.mockResolvedValueOnce({
      task: { id: 't11', title: 'Позвонить', completed: false },
      proposal: { text: 'День перегружен — сдвинуть «Почту» на завтра?', staged: true },
      conflictWarning: 'Накладывается на время с встречей «Планёрка» 10:00–11:00.',
    });
    await useTaskStore.getState().quickAdd('позвонить завтра в 10:30');
    const msg = useChatStore.getState().messages[0];
    expect(msg.content).toBe('Накладывается на время с встречей «Планёрка» 10:00–11:00.\nДень перегружен — сдвинуть «Почту» на завтра?');
    expect(msg.pendingAction).not.toBeNull();
    expect(useRobotReactionStore.getState().reaction).toBeNull();
  });
});

describe('перенос и удаление встречи с экрана', () => {
  it('правка: наложение / «в Google не обновилась» → облачко', async () => {
    useEventStore.setState({ events: [{ id: 'e5', title: 'Встреча', date: '2026-12-01', startTime: '14:00' }] } as never);
    mockApi.put.mockResolvedValueOnce({ id: 'e5', title: 'Встреча', date: '2026-12-01', startTime: '16:00', endTime: '17:00', conflictWarning: 'Накладывается на время с задачей «Почта» в 16:30.' });
    await useEventStore.getState().updateEvent('e5', { startTime: '16:00' } as never);
    expect(useRobotReactionStore.getState().reaction?.text).toContain('Почта');
    expect(useEventStore.getState().events[0]).not.toHaveProperty('conflictWarning');
  });
  it('удаление: сервер предупредил про Google → облачко; встреча убрана из списка', async () => {
    useEventStore.setState({ events: [{ id: 'e6', title: 'Из Google', date: '2026-12-01', startTime: null }], upcoming: [] } as never);
    mockApi.delete.mockResolvedValueOnce({ success: true, warning: 'В Google Календаре не удалилась — убери там, иначе синхронизация вернёт её.' });
    await useEventStore.getState().deleteEvent('e6');
    expect(useRobotReactionStore.getState().reaction?.text).toContain('Google');
    expect(useEventStore.getState().events).toHaveLength(0);
  });
});

describe('канбан «Готово» = выполнено', () => {
  it('перетащил в «Готово» → робот радуется', async () => {
    useTaskStore.setState({ tasks: [{ id: 'k1', title: 'Отчёт', completed: false, kanbanStatus: 'todo' } as never] });
    mockApi.patch.mockResolvedValueOnce({ id: 'k1', title: 'Отчёт', completed: true, kanbanStatus: 'done' });
    await useTaskStore.getState().updateKanbanStatus('k1', 'done');
    expect(useRobotReactionStore.getState().reaction?.emotion).toBe('happy');
  });
});

describe('кнопка «Подтвердить» после перезапуска', () => {
  it('сервер ждёт ответа → кнопки возвращаются на ТО сообщение', async () => {
    useChatStore.setState({ messages: [] } as never);
    const ask = 'Записать расход 5000 ₸ (обед)? Подтверди — запишу.';
    mockApi.get
      .mockResolvedValueOnce([
        { id: 'm2', role: 'assistant', content: ask, createdAt: '2026-11-08T10:01:00Z' },
        { id: 'm1', role: 'user', content: 'потратил 5000 на обед', createdAt: '2026-11-08T10:00:00Z' },
      ])
      .mockResolvedValueOnce({ pending: { action: 'add_expense', input: { amount: 5000 } }, confirmationText: ask });
    await useChatStore.getState().fetchHistory(0);
    const msg = useChatStore.getState().messages.find((m) => m.id === 'm2');
    expect(msg?.pendingAction).toMatchObject({ action: 'add_expense' });
    expect(mockApi.get).toHaveBeenLastCalledWith('/voice/pending-action', 'test-token-123');
  });
  it('перед подтверждением фраза робота в стиле → кнопки всё равно находят сообщение', async () => {
    useChatStore.setState({ messages: [] } as never);
    const ask = 'Записать расход 15000 ₸ (кроссовки)? Подтверди — запишу.';
    mockApi.get
      .mockResolvedValueOnce([
        { id: 'm5', role: 'assistant', content: `Копил на «отпуск», а купил это. Классика.\n\n${ask}`, createdAt: '2026-11-10T10:01:00Z' },
      ])
      .mockResolvedValueOnce({ pending: { action: 'add_expense', input: { amount: 15000 } }, confirmationText: ask });
    await useChatStore.getState().fetchHistory(0);
    expect(useChatStore.getState().messages.find((m) => m.id === 'm5')?.pendingAction).toMatchObject({ action: 'add_expense' });
  });
  it('текст не совпал → кнопки не вешаем на чужое сообщение', async () => {
    useChatStore.setState({ messages: [] } as never);
    mockApi.get
      .mockResolvedValueOnce([{ id: 'm3', role: 'assistant', content: 'Привет!', createdAt: '2026-11-08T10:00:00Z' }])
      .mockResolvedValueOnce({ pending: { action: 'add_expense', input: {} }, confirmationText: 'Записать расход?' });
    await useChatStore.getState().fetchHistory(0);
    expect(useChatStore.getState().messages[0].pendingAction ?? null).toBeNull();
  });
});

describe('чек с фото: вопрос с кнопками', () => {
  it('showPendingQuestion → сообщение робота с кнопками; старые кнопки сняты; «Записать» = обычное подтверждение', async () => {
    useChatStore.setState({ messages: [{ id: 'old', role: 'assistant', content: 'старый вопрос', pendingAction: { action: 'add_income', input: {} }, createdAt: '2026-11-08T09:00:00Z' }] } as never);
    const id = useChatStore.getState().showPendingQuestion('С чека: 3 500 ₸ · Magnum · Еда. Записать трату?', { action: 'add_expense', input: { amount: 3500 } });
    const [first, second] = useChatStore.getState().messages;
    expect(first.id).toBe(id);
    expect(first.pendingAction).toMatchObject({ action: 'add_expense' });
    expect(second.pendingAction ?? null).toBeNull();
  });
});
