jest.mock('@/navigation/ref', () => ({ navigateTo: jest.fn(), currentRouteName: jest.fn(() => 'Settings') }));

import { routeHasCommandBar } from '@/services/command-bar';
import { openScreen } from '@/navigation/open-screen';
import { hiddenPanelReason, toolKeyForRoute } from '@/services/panels';
import { useRoomToolStore } from '@/stores/room-tool-store';
import { navigateTo } from '@/navigation/ref';

describe('команда роботу с любого экрана', () => {
  it('строка «Скажи роботу» на всех экранах стека, кроме дома/чата/разговора/входа', () => {
    for (const r of ['Settings', 'KanbanBoard', 'FocusMode', 'TaskCapture', 'GanttView', 'LifeInsights', 'Import', 'Journal', 'Calendar']) {
      expect(routeHasCommandBar(r)).toBe(true);
    }
    for (const r of ['Home', 'ChatHistory', 'VoiceConversation', 'Auth', 'Onboarding']) {
      expect(routeHasCommandBar(r)).toBe(false);
    }
  });

  it('старая панель (Tasks/Finance) → вкладка дома, а не шторка; прочее — обычный переход', () => {
    const nav = jest.fn();
    expect(toolKeyForRoute('Finance')).toBe('finance');
    openScreen('Finance', nav);
    expect(navigateTo).toHaveBeenCalledWith('Home');
    expect(useRoomToolStore.getState().take()).toBe('finance');
    expect(nav).not.toHaveBeenCalled();
    openScreen('KanbanBoard', nav);
    expect(nav).toHaveBeenCalledWith('KanbanBoard', undefined);
  });

  it('скрытая вкладка: робот объясняет, а не молча открывает «Сегодня»', () => {
    const hidden = (f: string) => f !== 'finance_tab';
    expect(hiddenPanelReason('finance', hidden)).toContain('«Финансы» скрыта');
    expect(hiddenPanelReason('tasks', hidden)).toBeNull();
    expect(hiddenPanelReason('deals', () => true, { dealsAvailable: false })).toBe('Вкладка «Сделки» пока недоступна.');
  });
});
