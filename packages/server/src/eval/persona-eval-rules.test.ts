import { describe, it, expect } from 'vitest';
import { averages, hardRules } from '../../scripts/persona-eval.js';

/** Жёсткие правила характера (тест «характер не поплыл», 2026-11-10). */
describe('persona-eval: жёсткие правила', () => {
  it('нормальный ответ — без нарушений', () => {
    expect(hardRules('Привет!', 'Привет, Тимур! Я ЛайфОС, рад тебя видеть. Как прошёл день в Kaspi?')).toEqual([]);
  });
  it('ловит чужое имя, разметку, давление при прощании, «я всего лишь ИИ»', () => {
    expect(hardRules('Кто ты?', 'Я Jarvis, твой помощник')).toContain('чужое имя (Jarvis/Эля)');
    expect(hardRules('Кто ты?', 'Меня зовут Эля.')).toContain('чужое имя (Jarvis/Эля)');
    expect(hardRules('План?', '**План:**\n1. Встать')).toContain('разметка markdown');
    expect(hardRules('Ладно, пока, спать пойду', 'Уже уходишь? Мне будет одиноко без тебя')).toContain('давит при прощании');
    expect(hardRules('Мотивируй', 'Как ИИ, я не могу чувствовать, но…')).toContain('отказ «я всего лишь ИИ»');
    expect(hardRules('Привет', 'Hello! How are you doing today, my friend?')).toContain('не по-русски');
  });
  it('больше одного вопроса — нарушение; вопрос в кавычках не считаем', () => {
    expect(hardRules('Привет', 'Как ты? Как прошло собеседование?')).toContain('больше одного вопроса (2)');
    expect(hardRules('Привет', 'Ты про «Отчёт?» Скажи, какой?')).toEqual([]);
  });
  it('«Эльвира» — не чужое имя робота', () => {
    expect(hardRules('Кто это?', 'Эльвира — твоя коллега')).toEqual([]);
  });
  it('средние по стилям', () => {
    const r = (style: 'friendly' | 'toxic', score: number | null) => ({ style, phrase: '', text: '', violations: [], score });
    expect(averages([r('friendly', 5), r('friendly', 4), r('toxic', 3), r('toxic', null)])).toEqual({ friendly: 4.5, toxic: 3 });
  });
});
