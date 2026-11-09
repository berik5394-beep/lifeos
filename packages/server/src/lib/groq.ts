import Groq from 'groq-sdk';
import { observedFetch } from './observed-fetch.js';

/**
 * Единая фабрика Groq-клиента (Whisper). Ответы видны наблюдателю: ключ
 * не принят / нет оплаты → оповещение владельцу, распознавания → счётчик.
 */
export function createGroq(): Groq {
  return new Groq({
    apiKey: process.env.GROQ_API_KEY || '',
    fetch: observedFetch('groq') as unknown as NonNullable<ConstructorParameters<typeof Groq>[0]>['fetch'],
  });
}
