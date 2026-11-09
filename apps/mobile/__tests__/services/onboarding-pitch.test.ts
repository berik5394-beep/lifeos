import { PITCH_QUESTIONS, pitchAnswer } from '@/services/onboarding-pitch';
import { HELP_SECTIONS } from '@/services/robot-help';

describe('знакомство вопросами', () => {
  it('у каждого вопроса — ответ на «да» и на «нет», id уникальны', () => {
    expect(PITCH_QUESTIONS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(PITCH_QUESTIONS.map((q) => q.id)).size).toBe(PITCH_QUESTIONS.length);
    for (const q of PITCH_QUESTIONS) {
      expect(q.question).toMatch(/\?$/);
      expect(pitchAnswer(q, 'yes')).toBe(q.yes);
      expect(pitchAnswer(q, 'no')).toBe(q.no);
      expect(pitchAnswer(q, null)).toBeNull();
    }
  });

  it('сильные стороны Berik на месте: память, выслушать, напоминания с уведомлениями', () => {
    const all = PITCH_QUESTIONS.map((q) => `${q.yes} ${q.no}`).join(' ');
    expect(all).toMatch(/помню/);
    expect(all).toMatch(/выслушаю/);
    expect(PITCH_QUESTIONS.find((q) => q.action === 'notifications')?.yes).toMatch(/уведомления/);
  });
});

describe('«Как пользоваться»', () => {
  it('есть разделы про разговор, живой режим и деньги; примеры — непустые фразы', () => {
    const titles = HELP_SECTIONS.map((s) => s.title).join(' | ');
    expect(titles).toMatch(/Как говорить с роботом/);
    expect(titles).toMatch(/Живой разговор/);
    expect(titles).toMatch(/Деньги/);
    for (const s of HELP_SECTIONS) for (const e of s.examples ?? []) expect(e.trim().length).toBeGreaterThan(3);
  });
});
