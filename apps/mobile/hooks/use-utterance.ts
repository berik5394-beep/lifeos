import { useCallback, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useChatStore } from '@/stores/chat-store';
import { routeVoice } from '@/services/voice-route';

/**
 * Единая точка для сказанного/набранного роботу (один микрофон у поля ввода):
 * «ЛайфОС, …» срезается, диктофон и режим разговора включаются фразой,
 * всё остальное — в мозг. Диктофон рисует сам экран (DictationModal).
 */
export function useUtterance() {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const [dictationOpen, setDictationOpen] = useState(false);

  const handle = useCallback(
    (raw: string) => {
      const route = routeVoice(raw);
      if (route.kind === 'dictation') setDictationOpen(true);
      else if (route.kind === 'conversation') navigation.navigate('VoiceConversation');
      else if (route.text) void sendMessage(route.text, true);
    },
    [navigation, sendMessage],
  );
  const closeDictation = useCallback(() => setDictationOpen(false), []);
  return { handle, dictationOpen, closeDictation };
}
