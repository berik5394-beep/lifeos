import { prisma } from '../lib/prisma.js';

/**
 * Phase 3.3 — единый слой интеграций.
 *
 * Проблема, которую закрываем: ключи провайдеров ('google_calendar',
 * 'telegram') и логика «подключён ли / отключить / что умеет» были
 * размазаны строковыми литералами по роутам. С ростом числа интеграций
 * это превращается в кашу.
 *
 * Решение: один реестр-источник правды. Тонкие адаптеры НАД уже
 * работающими сервисами — OAuth/sync-логику НЕ переписываем (это
 * рискованно и не нужно), централизуем только метаданные, проверку
 * подключения и отключение + валидацию провайдера.
 */

export interface IntegrationDescriptor {
  /** Ключ провайдера в таблице Integration. */
  key: string;
  /** Человеческое имя для UI. */
  name: string;
  /** Что умеет (для UI/подсказок мозгу). */
  capabilities: string[];
  /** Подключена ли интеграция у юзера (готова к использованию). */
  isConnected(userId: string): Promise<boolean>;
  /** Отключить (идемпотентно — нет записи = уже отключено). */
  disconnect(userId: string): Promise<void>;
}

async function deleteIntegration(userId: string, provider: string): Promise<void> {
  await prisma.integration
    .delete({ where: { userId_provider: { userId, provider } } })
    .catch(() => {
      /* нет записи — уже отключено, идемпотентно */
    });
}

/**
 * google_calendar — один Google-OAuth покрывает Calendar (двусторонняя
 * синхронизация) И Gmail-триаж (scope расширен gmail.readonly). Поэтому
 * это ОДНА интеграция с двумя возможностями, не две.
 */
const googleCalendar: IntegrationDescriptor = {
  key: 'google_calendar',
  name: 'Google',
  capabilities: ['calendar_two_way_sync', 'gmail_triage'],
  async isConnected(userId) {
    const i = await prisma.integration.findUnique({
      where: { userId_provider: { userId, provider: 'google_calendar' } },
      select: { active: true, refreshToken: true },
    });
    // Подключена = активна И есть refresh-токен (иначе фоновый
    // доступ невозможен — для нас это «не подключено»).
    return !!i && i.active && !!i.refreshToken;
  },
  disconnect: (userId) => deleteIntegration(userId, 'google_calendar'),
};

const telegram: IntegrationDescriptor = {
  key: 'telegram',
  name: 'Telegram',
  capabilities: ['messaging', 'bot_commands', 'notifications_mirror'],
  async isConnected(userId) {
    const i = await prisma.integration.findUnique({
      where: { userId_provider: { userId, provider: 'telegram' } },
      select: { active: true, settings: true },
    });
    const chatId = (i?.settings as { chatId?: string } | null)?.chatId;
    return !!i && i.active && !!chatId;
  },
  disconnect: (userId) => deleteIntegration(userId, 'telegram'),
};

export const INTEGRATIONS: Record<string, IntegrationDescriptor> = {
  [googleCalendar.key]: googleCalendar,
  [telegram.key]: telegram,
};

export function getIntegration(key: string): IntegrationDescriptor | undefined {
  return INTEGRATIONS[key];
}

export interface IntegrationStatus {
  key: string;
  name: string;
  capabilities: string[];
  connected: boolean;
}

/** Каталог всех известных интеграций со статусом подключения юзера. */
export async function listIntegrationStatus(
  userId: string,
): Promise<IntegrationStatus[]> {
  return Promise.all(
    Object.values(INTEGRATIONS).map(async (d) => ({
      key: d.key,
      name: d.name,
      capabilities: d.capabilities,
      connected: await d.isConnected(userId),
    })),
  );
}
