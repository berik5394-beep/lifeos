import { api } from '@/services/api';
import { planVoiceFollowUp, confirmPendingVoiceAction, isConfirmable } from '@/services/voice-followup';

const mockApi = api as jest.Mocked<typeof api>;

describe('planVoiceFollowUp', () => {
  it('pendingAction → confirm с текстом сервера', () => {
    expect(
      planVoiceFollowUp({
        intent: { action: 'add_expense' },
        response: 'Записать расход 3000₸ на еду?',
        pendingAction: { action: 'add_expense', input: { amount: 3000 } },
        confirmationText: 'Записать расход 3000₸ на еду?',
      }),
    ).toEqual({ kind: 'confirm', text: 'Записать расход 3000₸ на еду?' });
  });
  it('pendingAction без текста → дефолтный вопрос', () => {
    expect(planVoiceFollowUp({ pendingAction: { action: 'add_income', input: {} } })).toEqual({
      kind: 'confirm',
      text: 'Подтвердить действие?',
    });
  });
  it('слот-вопрос «На что потратил?» (__awaitingCategory/__awaitingSource) → done: отвечают голосом, не кнопкой', () => {
    expect(
      planVoiceFollowUp({
        response: 'На что потратил 3000₸? (или «отмена»)',
        pendingAction: { action: 'add_expense', input: { amount: 3000, __awaitingCategory: true } },
        confirmationText: 'На что потратил 3000₸? (или «отмена»)',
      }),
    ).toEqual({ kind: 'done' });
    expect(isConfirmable({ action: 'add_income', input: { amount: 1, __awaitingSource: true } })).toBe(false);
    expect(isConfirmable({ action: 'add_income', input: { amount: 1, source: 'зп' } })).toBe(true);
  });
  it('без pendingAction → done', () => {
    expect(planVoiceFollowUp({ intent: { action: 'create_task' }, response: 'Задача создана', pendingAction: null })).toEqual({
      kind: 'done',
    });
  });
});

describe('confirmPendingVoiceAction', () => {
  beforeEach(() => jest.clearAllMocks());
  it('200 → текст и интент сервера, шлёт confirm на /voice/confirm-action', async () => {
    mockApi.post.mockResolvedValueOnce({ message: 'Записал расход 3000₸', intent: 'add_expense', done: true });
    await expect(confirmPendingVoiceAction(true)).resolves.toEqual({ message: 'Записал расход 3000₸', intent: 'add_expense' });
    expect(mockApi.post).toHaveBeenCalledWith('/voice/confirm-action', { confirm: true }, 'test-token-123');
  });
  it('409 → «устарело», не бросает', async () => {
    mockApi.post.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
    await expect(confirmPendingVoiceAction(true)).resolves.toEqual({
      message: 'Нечего подтверждать — предложение устарело. Повтори запрос.',
      intent: null,
    });
  });
  it('сеть упала → бросает (UI покажет ошибку)', async () => {
    mockApi.post.mockRejectedValueOnce(new Error('network'));
    await expect(confirmPendingVoiceAction(false)).rejects.toThrow('network');
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';

describe('экраны не исполняют голос сами (voice-one-brain)', () => {
  it.each(['index.tsx', 'tasks.tsx', 'habits.tsx'])('%s: нет handleVoiceAction', (f) => {
    const src = readFileSync(join(__dirname, '../../app/(tabs)', f), 'utf-8');
    expect(src).not.toMatch(/handleVoiceAction/);
    expect(src).not.toMatch(/Auto-execute voice actions/);
  });
});
