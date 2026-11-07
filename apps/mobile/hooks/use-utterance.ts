import { useCallback, useState } from 'react';
import { navigateTo } from '@/navigation/ref';
import { useChatStore } from '@/stores/chat-store';
import { routeVoice } from '@/services/voice-route';

/**
 * Единая точка для сказанного/набранного роботу (один микрофон у поля ввода):
 * «ЛайфОС, …» срезается, диктофон и режим разговора включаются фразой,
 * всё остальное — в мозг. Диктофон рисует сам экран (DictationModal).
 */
export function useUtterance() {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const [dictationOpen, setDictationOpen] = useState(false);

  const handle = useCallback(
    // spoken — пришло с микрофона: ответ будет вслух и коротким.
    (raw: string, spoken = false) => {
      const route = routeVoice(raw);
      if (route.kind === 'dictation') setDictationOpen(true);
      // Через общий ref: голос теперь живёт над всем стеком, а не внутри экрана.
      else if (route.kind === 'conversation') navigateTo('VoiceConversation');
      else if (route.text) void sendMessage(route.text, true, { spoken });
    },
    [sendMessage],
  );
  const closeDictation = useCallback(() => setDictationOpen(false), []);
  return { handle, dictationOpen, closeDictation };
}
