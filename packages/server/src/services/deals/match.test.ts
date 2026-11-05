import { describe, it, expect } from 'vitest';
import { matchDealsByMention, textMentionsClient, titleMatches } from './service.js';

/** Ревью-3 I2: имена с казахскими буквами (ә, ғ, қ, ң, ө, ұ, ү, һ, і). */
const deals = (...names: string[]) => names.map((personName) => ({ personName }));

describe('матч клиента по упоминанию — казахские буквы', () => {
  it.each([
    ['Нұрлан', 'от Нұрлана'],
    ['Нұрлан', 'Нұрланом'],
    ['Әлия', 'от Әлии'],
    ['Әлия', 'Әлия'],
    ['Қайрат', 'от Қайрата'],
    ['Гүлім', 'от Гүлім'],
    ['Айгүл', 'от Айгүлі'],
    ['Ахмет', 'от Ахмета'],
  ])('сделка «%s» ← «%s»', (name, mention) => {
    expect(matchDealsByMention(deals(name), mention)).toHaveLength(1);
  });

  it.each([
    ['Әлия', 'от Лии'],
    ['Әлия', 'Лия'],
    ['Нұрлан', 'от Рлана'],
    ['Ахмет', 'от Ахмеда'],
  ])('сделка «%s» НЕ ← «%s»', (name, mention) => {
    expect(matchDealsByMention(deals(name), mention)).toHaveLength(0);
  });

  it('упоминание клиента в свободном тексте — казахское имя', () => {
    expect(textMentionsClient(['Нұрлан'], 'как там Нұрлан по складу?')).toBe(true);
    expect(textMentionsClient(['Әлия'], 'как там Лия по складу?')).toBe(false);
  });

  it('название сделки с казахскими буквами — общий корень', () => {
    expect(titleMatches('құрылыс материалы', 'құрылысқа')).toBe(true);
  });
});
