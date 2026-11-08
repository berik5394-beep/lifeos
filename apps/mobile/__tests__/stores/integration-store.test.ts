import { api } from '@/services/api';
import { useIntegrationStore, GMAIL_SEND_SCOPE } from '@/stores/integration-store';

const mockApi = api as jest.Mocked<typeof api>;
const google = (scopes?: string[]) => ({
  id: 'g',
  provider: 'google_calendar',
  active: true,
  settings: scopes ? { scopes } : {},
  createdAt: '2026-11-08',
});

beforeEach(() => {
  jest.clearAllMocks();
  useIntegrationStore.setState({ integrations: [], isLoading: false });
});

describe('integration-store', () => {
  it('Google на сервере google_calendar — экран (google-calendar) видит «подключено»', () => {
    useIntegrationStore.setState({ integrations: [google()] });
    expect(useIntegrationStore.getState().isConnected('google-calendar')).toBe(true);
  });
  it('«Отключить» идёт на серверный ключ и убирает из списка', async () => {
    useIntegrationStore.setState({ integrations: [google()] });
    mockApi.delete.mockResolvedValueOnce({} as never);
    await useIntegrationStore.getState().disconnect('google-calendar');
    expect(mockApi.delete).toHaveBeenCalledWith('/integrations/google_calendar', 'test-token-123');
    expect(useIntegrationStore.getState().isConnected('google-calendar')).toBe(false);
  });
  it('право на письма — только если Google его выдал', () => {
    useIntegrationStore.setState({ integrations: [google(['https://www.googleapis.com/auth/calendar'])] });
    expect(useIntegrationStore.getState().canSendMail()).toBe(false);
    useIntegrationStore.setState({ integrations: [google(['https://www.googleapis.com/auth/calendar', GMAIL_SEND_SCOPE])] });
    expect(useIntegrationStore.getState().canSendMail()).toBe(true);
  });
});
