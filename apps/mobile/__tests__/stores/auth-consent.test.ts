/**
 * App Store 2026-11-10: согласие (16+, условия, сторонний ИИ) — сервер решает, нужно ли;
 * без сети не запираем; «Принимаю» уходит с версией и подтверждением возраста.
 */
jest.unmock('@/stores/auth-store');
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async () => {}),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(async () => {}),
}));

import { api } from '@/services/api';
import { CONSENT_VERSION } from '@/constants/legal-text';

const { useAuthStore } = jest.requireActual('@/stores/auth-store') as typeof import('@/stores/auth-store');
const mocked = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ token: 'access-1', consentRequired: false });
});

describe('согласие', () => {
  it('сервер просит — экран согласия', async () => {
    mocked.get.mockResolvedValueOnce({ user: { consentRequired: true } });
    await useAuthStore.getState().checkConsent();
    expect(mocked.get).toHaveBeenCalledWith('/auth/me', 'access-1');
    expect(useAuthStore.getState().consentRequired).toBe(true);
  });
  it('нет сети — не запираем', async () => {
    mocked.get.mockRejectedValueOnce(new Error('offline'));
    await useAuthStore.getState().checkConsent();
    expect(useAuthStore.getState().consentRequired).toBe(false);
  });
  it('«Принимаю» — версия и 16+ на сервер, экран уходит', async () => {
    useAuthStore.setState({ consentRequired: true });
    mocked.post.mockResolvedValueOnce({ consentVersion: CONSENT_VERSION });
    await useAuthStore.getState().acceptConsent();
    expect(mocked.post).toHaveBeenCalledWith('/auth/consent', { ageConfirmed: true, version: CONSENT_VERSION }, 'access-1');
    expect(useAuthStore.getState().consentRequired).toBe(false);
  });
  it('регистрация с галочкой — согласие уходит вместе с ней', async () => {
    mocked.post.mockResolvedValueOnce({ accessToken: 'a', refreshToken: 'r', user: { id: 'u', email: 'e', name: 'n', currency: '₸' } });
    await useAuthStore.getState().register('e@a.kz', 'Берик', 'password1', true);
    expect(mocked.post).toHaveBeenCalledWith('/auth/register', { email: 'e@a.kz', name: 'Берик', password: 'password1', consent: true });
  });
});
