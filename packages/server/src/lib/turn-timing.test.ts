import { describe, it, expect } from 'vitest';
import { createTurnTiming } from './turn-timing.js';

describe('createTurnTiming', () => {
  it('шаги, первое слово (только первое), итог', () => {
    let t = 1000;
    const tm = createTurnTiming(() => t);
    t = 1300;
    tm.mark('intent');
    t = 1900;
    tm.mark('ctx');
    t = 2500;
    tm.firstToken();
    t = 2600;
    tm.firstToken();
    t = 4000;
    expect(tm.line({ ch: 'voice' })).toBe('[jarvis:timing] intent=300 ctx=900 first=1500 total=3000 ch=voice');
  });
});
