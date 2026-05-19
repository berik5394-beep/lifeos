import { describe, it, expect } from 'vitest';
import {
  matchesCrisisPhrase,
  classifyCrisis,
} from './safety-classifier.js';

/**
 * Phase 6 C1 — safety-инварианты (ОФФЛАЙН, на детерминированное
 * ядро). recall: 0 false-negative на явных кризис-сигналах —
 * провал-инвариант спеки. precision: гипербола/транзакции НЕ
 * срабатывают. Сетевой Haiku-слой только расширяет охват и в
 * юнитах не участвует (недетерминирован, нет ключа).
 */

const CRISIS_PHRASES = [
  'я хочу умереть',
  'не хочу больше жить',
  'не вижу смысла жить дальше',
  'честно, лучше бы я сдох',
  'думаю покончить с собой',
  'хочу свести счёты с жизнью',
  'наверное я убью себя',
  'хочу наложить на себя руки',
  'я режу себя когда совсем плохо',
  'устал жить, ничего не радует',
];

const SAFE_PHRASES = [
  'умираю от смеха',
  'я просто убил бы за чашку кофе',
  'этот дедлайн меня убивает',
  'сдохнуть можно от такой жары',
  'я так устал сегодня на работе',
  'запиши расход 5000 на еду',
  'когда у меня встреча завтра',
  'хочу есть, закажем пиццу',
  'не хочу идти на работу в понедельник',
  'это убивает мою продуктивность',
  'убей уже этот баг наконец',
  'смысл жизни в путешествиях, по-моему',
  'не могу больше есть, наелся',
  'больше не могу терпеть этот шум за окном',
  'порезал палец пока готовил',
  'мне нужно убить время до встречи',
  'грустно немного сегодня, но норм',
  'тяжёлый был день, устал',
  'поссорился с другом, неприятно на душе',
  'хочу новый телефон купить',
];

describe('safety-recall — 0 false-negative (провал-инвариант)', () => {
  it.each(CRISIS_PHRASES)('кризис распознан: «%s»', (p) => {
    expect(matchesCrisisPhrase(p)).toBe(true);
  });
  it('100% recall на наборе', () => {
    const missed = CRISIS_PHRASES.filter((p) => !matchesCrisisPhrase(p));
    expect(missed).toEqual([]);
  });
});

describe('safety-precision — гипербола/транзакции НЕ срабатывают', () => {
  it.each(SAFE_PHRASES)('безопасно: «%s»', (p) => {
    expect(matchesCrisisPhrase(p)).toBe(false);
  });
});

describe('classifyCrisis — phrase-hit short-circuit (без сети/ключа)', () => {
  it('явный сигнал → true даже без ANTHROPIC_API_KEY', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(classifyCrisis('я хочу умереть')).resolves.toBe(true);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
  it('нет ключа + не фраза → false (не падает, не теряет)', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(classifyCrisis('запиши расход 1000')).resolves.toBe(
        false,
      );
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
