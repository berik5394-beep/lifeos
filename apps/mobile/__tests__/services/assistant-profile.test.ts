import { api } from '@/services/api';
import { storage } from '@/services/storage';
import { saveAssistantProfile, loadAssistantProfile } from '@/services/assistant-profile';

const mocked = api as jest.Mocked<typeof api>;
beforeEach(() => jest.clearAllMocks());

describe('стиль ассистента — на сервере, не только в телефоне', () => {
  it('выбор стиля уходит в PATCH /auth/profile и кэшируется', async () => {
    mocked.patch.mockResolvedValueOnce({});
    await saveAssistantProfile({ assistantStyle: 'toxic' });
    expect(mocked.patch).toHaveBeenCalledWith('/auth/profile', { assistantStyle: 'toxic' }, 'test-token-123');
    expect(storage.getString('assistantStyle')).toBe('toxic');
  });
  it('сервер не сохранил → ошибка, кэш не меняется', async () => {
    storage.set('assistantGender', 'female');
    mocked.patch.mockRejectedValueOnce(new Error('Ошибка сервера'));
    await expect(saveAssistantProfile({ assistantGender: 'male' })).rejects.toThrow();
    expect(storage.getString('assistantGender')).toBe('female');
  });
  it('при открытии настроек — значения с сервера', async () => {
    mocked.get.mockResolvedValueOnce({ user: { assistantStyle: 'calm', assistantGender: 'male', wakeUpTime: '06:30' } });
    expect(await loadAssistantProfile()).toEqual({ assistantStyle: 'calm', assistantGender: 'male', wakeUpTime: '06:30' });
    expect(storage.getString('wakeUpTime')).toBe('06:30');
  });
});
