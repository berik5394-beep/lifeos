import { useState, useEffect, useCallback } from 'react';
import { createMMKV } from 'react-native-mmkv';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatDate } from '@/utils/dates';

const storage = createMMKV({ id: 'greeting-storage' });

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

    api
      .post<AssistantResponse>(
        '/voice/assistant',
        { text: 'Доброе утро' },
        token,
      )
      .then((response) => {
        setGreeting(response.reply);
      })
      .catch(() => {
        setGreeting('Доброе утро! Отличного дня!');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [token]);

  const dismissGreeting = useCallback(() => {
    const todayStr = formatDate(new Date());
    storage.set('lastGreetingDate', todayStr);
    setShouldShowGreeting(false);
  }, []);

  const handleChipPress = useCallback(
    async (action: string, text: string): Promise<string | null> => {
      if (!token) return null;
      try {
        const response = await api.post<AssistantResponse>(
          '/voice/assistant',
          { text },
          token,
        );
        return response.reply;
      } catch {
        return null;
      }
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
