import { describe, it, expect } from 'vitest';
import { parseMinutes } from './estimate-task-minutes.js';

describe('parseMinutes — парс ответа haiku', () => {
  it('чистое число', () => expect(parseMinutes('90')).toBe(90));
  it('число со словами', () => expect(parseMinutes('примерно 120 минут')).toBe(120));
  it('меньше 5 → клампим к 5', () => expect(parseMinutes('3')).toBe(5));
  it('больше 480 → клампим к 480', () => expect(parseMinutes('5000')).toBe(480));
  it('мусор → дефолт 30', () => expect(parseMinutes('не знаю')).toBe(30));
  it('пусто → дефолт 30', () => expect(parseMinutes('')).toBe(30));
});
