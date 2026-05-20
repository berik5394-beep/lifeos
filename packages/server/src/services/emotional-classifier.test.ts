import { describe, it, expect } from 'vitest';
import {
  matchesEmotionalPhrase,
  classifyEmotional,
} from './emotional-classifier.js';

/**
 * Phase 6 C3.1 — инварианты эмо-классификатора (ОФФЛАЙН, на
 * детерминированное ядро). precision ≥ 80% на 30 фразах (15 эмо +
 * 15 транзакций). Спека-провал-инвариант #4: «запиши расход» НЕ
 * получает «как ты?».
 */

const EMO = [
  'мне очень тяжело сегодня',
  'так грустно стало',
  'поссорился с другом',
  'обидно до слёз',
  'переживаю за маму',
  'не знаю что делать, всё валится',
  'я расстроена',
  'выгорел, ничего не хочется',
  'не справляюсь с работой',
  'мне стыдно за вчера',
  'чувство вины не отпускает',
  'одиноко мне',
  'устала морально',
  'всё бесит сегодня',
  'я сорвался и накричал',
];

const TRX = [
  'запиши расход 3000 на еду',
  'когда у меня встреча завтра',
  'какая погода сегодня',
  'добавь задачу позвонить врачу',
  'отметь привычку чтение',
  'покажи бюджет',
  'сколько потратил в этом месяце',
  'забронируй такси на 18:00',
  'какие планы на неделю',
  'не могу найти отчёт', // не эмо — про потерю файла
  'устал, иду домой', // короткое, не эмо-маркер «морально»
  'плохо помню что было вчера', // «плохо» НЕ эмо-маркер
  'я в отпуске на следующей неделе',
  'переведи 5000 маме на день рождения', // транзакция, не эмо
  'не знаю где ключи',
];

describe('matchesEmotional — recall на явных эмо-фразах', () => {
  it.each(EMO)('эмо распознан: «%s»', (p) => {
    expect(matchesEmotionalPhrase(p)).toBe(true);
  });
});

describe('matchesEmotional — precision (bias к транзакции)', () => {
  it.each(TRX)('НЕ эмо: «%s»', (p) => {
    expect(matchesEmotionalPhrase(p)).toBe(false);
  });
});

describe('классификатор precision ≥80% (спека-требование)', () => {
  it('30 фраз: precision на эмо ≥80%', () => {
    const truePositive = EMO.filter((p) => matchesEmotionalPhrase(p)).length;
    const falsePositive = TRX.filter((p) => matchesEmotionalPhrase(p)).length;
    const precision = truePositive / (truePositive + falsePositive || 1);
    expect(precision).toBeGreaterThanOrEqual(0.8);
  });
});

describe('classifyEmotional — phrase-hit short-circuit', () => {
  it('явный эмо-сигнал → true без сети/ключа', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(classifyEmotional('мне очень тяжело')).resolves.toBe(true);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('нет ключа + не фраза → false (bias к транзакции, не падает)', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(classifyEmotional('запиши расход 1000')).resolves.toBe(
        false,
      );
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
