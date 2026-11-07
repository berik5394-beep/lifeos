import { api } from '@/services/api';

/**
 * «Забыли пароль?»: код на почту (и в Telegram, если подключён) → новый
 * пароль. Без входа (токена нет). Ответы сервера — уже понятным текстом.
 */
export async function requestResetCode(email: string): Promise<string> {
  const res = await api.post<{ message?: string }>('/auth/forgot-password', { email: email.trim().toLowerCase() });
  return res.message ?? 'Если аккаунт с этой почтой есть, мы отправили код.';
}

export async function resetPasswordWithCode(email: string, code: string, newPassword: string): Promise<string> {
  const res = await api.post<{ message?: string }>('/auth/reset-password', {
    email: email.trim().toLowerCase(),
    code: code.replace(/\D/g, ''),
    newPassword,
  });
  return res.message ?? 'Пароль изменён. Войдите с новым паролем.';
}

/** Проверки до отправки — те же правила, что на сервере. null — всё ок. */
export function resetFormError(code: string, password: string, repeat: string): string | null {
  if (code.replace(/\D/g, '').length !== 6) return 'Код — 6 цифр из письма';
  if (password.length < 8) return 'Пароль минимум 8 символов';
  if (!/[a-zA-Zа-яА-Я]/.test(password) || !/[0-9]/.test(password)) return 'В пароле нужна хотя бы одна буква и одна цифра';
  if (password !== repeat) return 'Пароли не совпадают';
  return null;
}
