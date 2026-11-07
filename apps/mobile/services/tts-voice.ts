import * as Speech from 'expo-speech';
import { storage } from '@/services/storage';

// ==========================================================
// TTS VOICE RESOLUTION (gender-aware)
// ==========================================================
// Picks a russian voice matching the user's assistantGender preference
// stored in MMKV-like storage by onboarding / settings screens.
// Cached per-session; re-resolves when gender changes.
let cachedVoiceId: string | undefined;
let cachedFor: string | undefined;

export async function getPreferredVoiceIdentifier(): Promise<string | undefined> {
  try {
    const gender = (storage.getString('assistantGender') as 'female' | 'male' | undefined) ?? 'female';
    if (cachedFor === gender && cachedVoiceId !== undefined) {
      return cachedVoiceId;
    }
    const voices = await Speech.getAvailableVoicesAsync();
    const russian = voices.filter((v) => v.language?.startsWith('ru'));
    // iOS voices sometimes expose gender via name; Android rarely does.
    // Fall back to name heuristics.
    const byGender = russian.find((v) => {
      const name = (v.name || v.identifier || '').toLowerCase();
      if (gender === 'male') {
        return (
          name.includes('male') ||
          name.includes('мужск') ||
          name.includes('yuri') ||
          name.includes('milena-m')
        );
      }
      return (
        name.includes('female') ||
        name.includes('женск') ||
        name.includes('milena') ||
        name.includes('katya')
      );
    });
    cachedVoiceId = byGender?.identifier ?? russian[0]?.identifier;
    cachedFor = gender;
    return cachedVoiceId;
  } catch {
    return undefined;
  }
}


/**
 * Текст для озвучки: без эмодзи, ссылок и разметки; длинное — до конца
 * предложения в пределах лимита (голосом слушать полстраницы никто не будет).
 */
export function speakableText(text: string, max = 600): string {
  let t = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    t = end > max / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }
  return t;
}

/** Робот отвечает вслух (сказали голосом — отвечаем голосом). Прерывает прежнюю речь. */
export async function speakReply(text: string): Promise<void> {
  const t = speakableText(text);
  if (!t) return;
  try {
    Speech.stop();
    const voice = await getPreferredVoiceIdentifier();
    Speech.speak(t, { language: 'ru-RU', rate: 1.05, voice });
  } catch {
    /* озвучка — не критично */
  }
}

/**
 * Озвучка по фразам (потоковый ответ): каждая фраза — в очередь, без остановки
 * предыдущей. Голос выбирается один раз на ответ.
 */
export function createPhraseVoice(): { say: (sentence: string) => void; stop: () => void } {
  const voice = getPreferredVoiceIdentifier().catch(() => undefined);
  let first = true;
  return {
    say: (sentence) => {
      const t = speakableText(sentence);
      if (!t) return;
      const startFresh = first;
      first = false;
      void voice.then((v) => {
        try {
          if (startFresh) Speech.stop(); // прежний ответ — замолчать
          Speech.speak(t, { language: 'ru-RU', rate: 1.05, voice: v });
        } catch {
          /* озвучка — не критично */
        }
      });
    },
    stop: () => {
      first = true;
      stopSpeaking();
    },
  };
}

/** Замолчать (человек снова заговорил). */
export function stopSpeaking(): void {
  try {
    Speech.stop();
  } catch {
    /* ignore */
  }
}
