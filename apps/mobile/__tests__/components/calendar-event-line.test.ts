import { parseEventLine } from '@/components/calendar/calendar-logic';

describe('строка «Новое событие»', () => {
  it.each([
    ['14:00 встреча с Ахметом', { title: 'Встреча с Ахметом', startTime: '14:00' }],
    ['стоматолог в 9:30', { title: 'Стоматолог', startTime: '09:30' }],
    ['встреча 15-16', { title: 'Встреча', startTime: '15:00', endTime: '16:00' }],
    ['день рождения мамы', { title: 'День рождения мамы' }],
  ])('«%s»', (raw, want) => expect(parseEventLine(raw)).toEqual(expect.objectContaining(want)));
  it('пусто или одно время — не событие', () => {
    expect(parseEventLine('')).toBeNull();
    expect(parseEventLine('14:00')).toBeNull();
  });
});
