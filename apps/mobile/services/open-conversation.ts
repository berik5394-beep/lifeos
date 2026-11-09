import { stopSpeaking } from '@/services/tts-voice';
import { navigateTo } from '@/navigation/ref';

/**
 * Живой разговор с роботом (говоришь — он отвечает голосом и снова слушает).
 * Berik 2026-11-09: открывается тапом по самому роботу — на инструментах и в
 * комнате; микрофон в строке остаётся «нажал — сказал — отправил». Мозг тот же
 * (`/voice/conversation/message` → handleMessage), реплики — в общей истории.
 */
export function openConversation(): void {
  stopSpeaking();
  navigateTo('VoiceConversation');
}
