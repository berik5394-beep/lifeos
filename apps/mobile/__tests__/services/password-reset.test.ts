import { api } from '@/services/api';
import { requestResetCode, resetFormError, resetPasswordWithCode } from '@/services/password-reset';

const mockApi = api as jest.Mocked<typeof api>;
beforeEach(() => jest.clearAllMocks());

describe('«Забыли пароль?»', () => {
  it('код просим без токена, почту нормализуем', async () => {
    mockApi.post.mockResolvedValueOnce({ message: 'Отправили' });
    expect(await requestResetCode('  Leyla@Mail.RU ')).toBe('Отправили');
    expect(mockApi.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'leyla@mail.ru' });
  });
  it('сброс: из кода берём только цифры', async () => {
    mockApi.post.mockResolvedValueOnce({ message: 'Пароль изменён' });
    await resetPasswordWithCode('a@b.kz', '123 456', 'newpass456');
    expect(mockApi.post).toHaveBeenCalledWith('/auth/reset-password', { email: 'a@b.kz', code: '123456', newPassword: 'newpass456' });
  });
  it('проверки формы — понятным текстом', () => {
    expect(resetFormError('12345', 'newpass456', 'newpass456')).toBe('Код — 6 цифр из письма');
    expect(resetFormError('123456', 'short1', 'short1')).toBe('Пароль минимум 8 символов');
    expect(resetFormError('123456', 'onlyletters', 'onlyletters')).toMatch(/буква и одна цифра/);
    expect(resetFormError('123456', 'newpass456', 'newpass457')).toBe('Пароли не совпадают');
    expect(resetFormError('123 456', 'newpass456', 'newpass456')).toBeNull();
  });
});
