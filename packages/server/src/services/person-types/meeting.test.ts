import { describe, it, expect } from 'vitest';
import { matchPersonInText, minutesUntil, describeMeetingBrief, meetingPushBody, type PersonMeetingBrief } from './meeting.js';

describe('matchPersonInText', () => {
  it('точный токен', () => { expect(matchPersonInText('Ахмет', [], 'встреча Ахмет договор')).toBe(true); });
  it('префикс (склонение): Серик → «сериком»', () => { expect(matchPersonInText('Серик', [], 'обсудить с Сериком')).toBe(true); });
  it('alias со склонением не ложит: «Серёге» ≠ «Серёга»', () => { expect(matchPersonInText('Сергей', ['Серёга'], 'звонок Серёге')).toBe(false); });
  it('alias точный', () => { expect(matchPersonInText('Сергей', ['Серёга'], 'привет Серёга')).toBe(true); });
  it('короткое имя <3 норм-символов → не матчим (шум)', () => { expect(matchPersonInText('Ян', [], 'январь план')).toBe(false); });
  it('случайное слово не ложноматчит: «командой» ≠ «Команда»', () => { expect(matchPersonInText('Команда', [], 'встреча с командой')).toBe(false); });
  it('нет имени в тексте → false', () => { expect(matchPersonInText('Ахмет', [], 'обычная встреча')).toBe(false); });
});

describe('minutesUntil', () => {
  it('будущее', () => { expect(minutesUntil('13:00', '14:30')).toBe(90); });
  it('прошло → отрицательное', () => { expect(minutesUntil('15:00', '14:00')).toBe(-60); });
});

describe('describeMeetingBrief', () => {
  const base: PersonMeetingBrief = { entityId: 'e', name: 'Ахмет', type: 'client', startTime: '14:00', minutesUntil: 50, daysSince: 12 };
  it('богатый кросс-домен: тип + контакт + дело + деньги', () => {
    const s = describeMeetingBrief({ ...base, obligation: 'договор', owed: 200000 });
    expect(s).toContain('Ахмет'); expect(s).toContain('клиент'); expect(s).toContain('12 дн');
    expect(s).toContain('договор'); expect(s).toContain('Тебе должны 200 000 ₸');
  });
  it('далёкая встреча → «сегодня в HH:MM»', () => {
    expect(describeMeetingBrief({ ...base, minutesUntil: 200 })).toContain('сегодня в 14:00');
  });
  it('сделка в брифе', () => {
    const t = describeMeetingBrief({
      entityId: 'e', name: 'Ахмет', type: 'client', startTime: '15:00', minutesUntil: 50, daysSince: 3,
      deal: 'Сделка «оборудование» 2 млн ₸, КП отправлено 4 дн назад.',
    });
    expect(t).toBe('📅 через ~50 мин — встреча с [клиент] Ахмет. Последний контакт 3 дн. Сделка «оборудование» 2 млн ₸, КП отправлено 4 дн назад.');
  });
});

describe('meetingPushBody — Джарвис-бриф за час', () => {
  const base: PersonMeetingBrief = { entityId: 'e', name: 'Серик', type: 'client', startTime: '15:00', minutesUntil: 60, daysSince: 5 };
  it('обещания в обе стороны, долги в обе стороны, сделка, память', () => {
    expect(
      meetingPushBody({
        ...base,
        iPromised: 'отправить прайс',
        theyPromised: 'подписать договор',
        owed: 200000,
        iOwe: 15000,
        deal: 'Сделка «турникеты» 2 млн ₸, КП отправлено 4 дн назад.',
        remembered: 'Обсуждали с Сериком турникеты для склада.',
      }),
    ).toBe(
      'Серик (клиент). Твоё обещание: «отправить прайс». Обещали тебе: «подписать договор». Тебе должны 200 000 ₸. ' +
        'За тобой долг 15 000 ₸. Сделка «турникеты» 2 млн ₸, КП отправлено 4 дн назад. Помню: «Обсуждали с Сериком турникеты для склада».',
    );
  });
  it('только память — тоже бриф', () => {
    expect(meetingPushBody({ ...base, type: undefined, remembered: 'Любит кофе без сахара' })).toBe('Серик. Помню: «Любит кофе без сахара».');
  });
  it('сказать нечего — null (обычное напоминание)', () => {
    expect(meetingPushBody(base)).toBeNull();
  });
});
