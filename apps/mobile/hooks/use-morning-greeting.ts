import { useState, useEffect, useCallback } from 'react';
import { storage } from '@/services/storage';
import { api, BRAIN_TIMEOUT_MS } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatDate } from '@/utils/dates';
import { useChatStore } from '@/stores/chat-store';

interface AssistantResponse {
  reply: string;
  action?: string;
}

interface UseMorningGreetingResult {
  shouldShowGreeting: boolean;
  greeting: string;
  isLoading: boolean;
  dismissGreeting: () => void;
  handleChipPress: (action: string, text: string) => Promise<string | null>;
}

export function useMorningGreeting(): UseMorningGreetingResult {
  const [shouldShowGreeting, setShouldShowGreeting] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const token = useAuthStore((state) => state.token);

  useEffect(() => {
    const todayStr = formatDate(new Date());
    const lastDate = storage.getString('lastGreetingDate');

    if (lastDate === todayStr) {
      setShouldShowGreeting(false);
      return;
    }

    if (!token) return;

    setShouldShowGreeting(true);
    setIsLoading(true);

    // Утренний бриф — тот же текст, что в пуше (задачи, встречи, бюджет, долги,
    // перегруз, темп целей). Раньше тут было общее «Доброе утро! Чем помочь?»,
    // и кто не открыл пуш, брифа не видел. Не вышло — прежнее приветствие.
    api
      .get<{ title: string; text: string; day?: string }>('/briefing/today', token, { timeoutMs: BRAIN_TIMEOUT_MS })
      .then((b) => {
        // Без сети api.get может вернуть кэш — вчерашний бриф не показываем.
        if (!b?.text || (b.day && b.day !== todayStr)) throw new Error('нет брифа на сегодня');
        setGreeting(`${b.title} ${b.text}`);
      })
      .catch(() =>
        api
          .post<AssistantResponse>('/voice/assistant', { text: 'Доброе утро' }, token, { timeoutMs: BRAIN_TIMEOUT_MS })
          .then((response) => setGreeting(response.reply)),
      )
      .catch(() => {
        setGreeting('Доброе утро! Отличного дня!');
      })
      .finally(() => {
        setIsLoading(false);
        // Один раз в день: раньше день отмечался только по «закрыть», и при
        // возврате на «Сегодня» приветствие показывалось и звучало заново.
        storage.set('lastGreetingDate', todayStr);
      });
  }, [token]);

  const dismissGreeting = useCallback(() => {
    const todayStr = formatDate(new Date());
    storage.set('lastGreetingDate', todayStr);
    setShouldShowGreeting(false);
  }, []);

  /**
   * Чип — обычная команда роботу через общий чат-стор (как строка «Скажи
   * роботу»): ответ облачком у робота + в истории, экраны перечитываются,
   * деньги приходят с кнопками «Подтвердить». Раньше чип ходил в
   * /voice/assistant мимо стора, и ответ просто выбрасывался.
   * «Спросить голосом» — ничего не шлёт: микрофон ниже, у строки ввода.
   */
  const handleChipPress = useCallback(
    async (action: string, text: string): Promise<string | null> => {
      if (!token || action === 'voice_ask') return null;
      await useChatStore.getState().sendMessage(text);
      const latest = useChatStore.getState().messages[0];
      return latest && latest.role === 'assistant' ? latest.content : null;
    },
    [token],
  );

  return {
    shouldShowGreeting,
    greeting,
    isLoading,
    dismissGreeting,
    handleChipPress,
  };
}
