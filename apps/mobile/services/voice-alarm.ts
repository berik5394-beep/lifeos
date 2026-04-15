/**
 * Voice Alarm — озвучивает уведомления голосом в зависимости от стиля ассистента.
 *
 * Когда пользователь забывает задачу/встречу:
 * - Дружелюбный: мягкое напоминание
 * - Строгий: чёткий приказ
 * - Спокойный: мудрый совет
 * - Токсичный: ОРЁТ и стыдит
 */

import * as Speech from 'expo-speech';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { storage } from '@/services/storage';

type AssistantStyle = 'friendly' | 'strict' | 'calm' | 'toxic';

function getAssistantStyle(): AssistantStyle {
  const stored = storage.getString('assistantStyle');
  return (stored as AssistantStyle) ?? 'friendly';
}

function getUserName(): string {
  try {
    const profile = storage.getString('user_profile');
    if (profile) {
      const parsed = JSON.parse(profile);
      return parsed.name || 'друг';
    }
  } catch { /* ignore */ }
  return 'друг';
}

// ─── Overdue Task Phrases ───────────────────────────────────────────────────

function getOverdueTaskPhrases(taskTitle: string, style: AssistantStyle, name: string): string[] {
  switch (style) {
    case 'toxic':
      return [
        `Эй, ${name}! Ты серьёзно забыл про "${taskTitle}"?! Это же позор!`,
        `${name}! Задача "${taskTitle}" просрочена! Ты что, спишь?! Вставай и делай!`,
        `Ало, ${name}! "${taskTitle}" висит уже давно! Ты собираешься это делать или нет?!`,
        `${name}, ты опять всё забыл! "${taskTitle}" уже просрочена! Стыдно должно быть!`,
        `Позорище, ${name}! "${taskTitle}" не выполнена! Хватит валяться, работай!`,
        `${name}! Очнись! "${taskTitle}" не сделана! Ты что, решил всё забросить?!`,
      ];
    case 'strict':
      return [
        `${name}, задача "${taskTitle}" просрочена. Выполни её немедленно.`,
        `Внимание, ${name}. "${taskTitle}" не выполнена. Это недопустимо.`,
        `${name}, "${taskTitle}" ждёт выполнения. Не откладывай.`,
      ];
    case 'calm':
      return [
        `${name}, напоминаю о задаче "${taskTitle}". Когда будешь готов — приступай.`,
        `Не забудь про "${taskTitle}", ${name}. Каждый шаг важен.`,
        `${name}, задача "${taskTitle}" ещё не выполнена. Не торопись, но и не забывай.`,
      ];
    case 'friendly':
    default:
      return [
        `Привет, ${name}! Ты забыл про "${taskTitle}". Давай закроем её вместе!`,
        `Эй, ${name}! "${taskTitle}" всё ещё ждёт тебя. Может займёмся?`,
        `${name}, напоминаю: "${taskTitle}" не выполнена. Ты справишься!`,
      ];
  }
}

// ─── Meeting Reminder Phrases ───────────────────────────────────────────────

function getMeetingReminderPhrases(title: string, minutesBefore: number, style: AssistantStyle, name: string): string[] {
  const timeText = minutesBefore <= 5 ? 'прямо сейчас' : `через ${minutesBefore} минут`;

  switch (style) {
    case 'toxic':
      return [
        `${name}! Встреча "${title}" ${timeText}! Ты хоть подготовился?! Давай быстрее!`,
        `Ало, ${name}! "${title}" ${timeText}! Хватит тупить, собирайся!`,
        `${name}, "${title}" ${timeText}! Ты опять опоздаешь? Классика!`,
      ];
    case 'strict':
      return [
        `${name}, встреча "${title}" ${timeText}. Будь готов.`,
        `Внимание: "${title}" ${timeText}. Не опаздывай, ${name}.`,
      ];
    case 'calm':
      return [
        `${name}, через некоторое время у тебя "${title}". Спокойно подготовься.`,
        `Напоминаю о встрече "${title}", ${name}. ${timeText}.`,
      ];
    case 'friendly':
    default:
      return [
        `${name}, не забудь! "${title}" ${timeText}. Удачи!`,
        `Привет! "${title}" ${timeText}. Готов, ${name}?`,
      ];
  }
}

function pickRandom(phrases: string[]): string {
  return phrases[Math.floor(Math.random() * phrases.length)];
}

// ─── Voice Settings ─────────────────────────────────────────────────────────

interface VoiceParams {
  rate: number;
  pitch: number;
  volume: number;
}

function getVoiceParams(style: AssistantStyle): VoiceParams {
  switch (style) {
    case 'toxic':
      // Loud, fast, aggressive
      return { rate: 1.1, pitch: 1.15, volume: 1.0 };
    case 'strict':
      // Firm, clear
      return { rate: 0.95, pitch: 0.95, volume: 0.9 };
    case 'calm':
      // Slow, soft
      return { rate: 0.8, pitch: 0.9, volume: 0.7 };
    case 'friendly':
    default:
      // Normal, warm
      return { rate: 0.9, pitch: 1.05, volume: 0.85 };
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Speak an overdue task alarm.
 * Only works when app is in foreground (TTS requires active audio session).
 */
export function speakOverdueTaskAlarm(taskTitle: string): void {
  // Only speak if app is active (in foreground)
  if (AppState.currentState !== 'active') return;

  const style = getAssistantStyle();
  const name = getUserName();
  const phrases = getOverdueTaskPhrases(taskTitle, style, name);
  const text = pickRandom(phrases);
  const params = getVoiceParams(style);

  // Stop any current speech
  Speech.stop();

  Speech.speak(text, {
    language: 'ru-RU',
    rate: params.rate,
    pitch: params.pitch,
    volume: params.volume,
  });
}

/**
 * Speak a meeting reminder alarm.
 */
export function speakMeetingAlarm(title: string, minutesBefore: number): void {
  if (AppState.currentState !== 'active') return;

  const style = getAssistantStyle();
  const name = getUserName();
  const phrases = getMeetingReminderPhrases(title, minutesBefore, style, name);
  const text = pickRandom(phrases);
  const params = getVoiceParams(style);

  Speech.stop();

  Speech.speak(text, {
    language: 'ru-RU',
    rate: params.rate,
    pitch: params.pitch,
    volume: params.volume,
  });
}

/**
 * Setup notification response listener that triggers voice alarms
 * when user interacts with alarm notifications.
 * Call once at app startup.
 */
export function setupVoiceAlarmListener(): () => void {
  // When a notification is received while app is in foreground
  const receivedSubscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      if (!data) return;

      // Only voice-alarm for 'alarm' type notifications while app is active
      if (data.type === 'alarm' && AppState.currentState === 'active') {
        const title = (data.title as string) || '';
        if (title) {
          // Small delay so the notification sound plays first
          setTimeout(() => {
            speakOverdueTaskAlarm(title);
          }, 1500);
        }
      }
    }
  );

  // When user taps on a notification
  const responseSubscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      if (!data) return;

      if (data.type === 'alarm') {
        const title = (data.title as string) || '';
        if (title) {
          speakOverdueTaskAlarm(title);
        }
      }
    }
  );

  return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
  };
}
