import { describe, it, expect } from 'vitest';
import { notifyOnlyRoute, telegramBotMode } from './telegram-notify-only.js';

describe('бот — только уведомления', () => {
  it('режим: по умолчанию notify, full — прежний бот', () => {
    expect(telegramBotMode({} as NodeJS.ProcessEnv)).toBe('notify');
    expect(telegramBotMode({ TELEGRAM_BOT_MODE: ' FULL ' } as NodeJS.ProcessEnv)).toBe('full');
  });
  it('привязка из приложения проходит как раньше', () => {
    expect(notifyOnlyRoute({ text: '/start link_ABCD2345', hasMessage: true })).toBe('pass');
    expect(notifyOnlyRoute({ text: '/link ABCD2345', hasMessage: true })).toBe('pass');
    expect(notifyOnlyRoute({ text: '/link@LifeOS_jarvis_bot ABCD2345', hasMessage: true })).toBe('pass');
    expect(notifyOnlyRoute({ callbackData: 'tglink:y:ABCD2345', hasMessage: false })).toBe('pass');
    expect(notifyOnlyRoute({ callbackData: 'tglink:n', hasMessage: false })).toBe('pass');
  });
  it('/start без кода — объяснение, где включить', () => {
    expect(notifyOnlyRoute({ text: '/start', hasMessage: true })).toBe('welcome');
    expect(notifyOnlyRoute({ text: '/start hello', hasMessage: true })).toBe('welcome');
  });
  it('текст, голос, фото, прочие команды — в приложение, без мозга', () => {
    expect(notifyOnlyRoute({ text: 'потратил 5000 на обед', hasMessage: true })).toBe('redirect');
    expect(notifyOnlyRoute({ text: '/setname Джарвис', hasMessage: true })).toBe('redirect');
    expect(notifyOnlyRoute({ hasMessage: true })).toBe('redirect'); // голос/фото — без текста
    expect(notifyOnlyRoute({ text: '/linked', hasMessage: true })).toBe('redirect');
  });
  it('чужие кнопки и служебные апдейты — молча', () => {
    expect(notifyOnlyRoute({ callbackData: 'other', hasMessage: false })).toBe('ignore');
    expect(notifyOnlyRoute({ hasMessage: false })).toBe('ignore');
  });
});
