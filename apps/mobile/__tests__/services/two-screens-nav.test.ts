import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Робот-эпик, Часть 3: вкладок нет — дом из двух экранов (Комната ↔ Рабочий),
 * инструменты открываются панелями-шторками (presentation: 'modal').
 */
const NAV = readFileSync(join(__dirname, '../../navigation/index.tsx'), 'utf-8');

describe('навигация: два экрана + панели', () => {
  it('нижних вкладок больше нет', () => {
    expect(NAV).not.toMatch(/createBottomTabNavigator/);
    expect(NAV).not.toMatch(/name="Tabs"/);
  });
  it('panelOptions — нативная шторка', () => {
    expect(NAV).toMatch(/const panelOptions = \{\s*presentation: 'modal'/);
  });
  it('дом — экран Home', () => {
    expect(NAV).toMatch(/<RootStack\.Screen\s+name="Home"/);
  });
  it.each(['Dashboard', 'Tasks', 'Habits', 'Goals', 'Finance', 'Calendar', 'Journal'])(
    'панель %s — шторка (modal)',
    (route) => {
      // В пределах ОДНОЙ регистрации (до '/>'): общие panelOptions или явный modal.
      const re = new RegExp(`name="${route}"[^>]*?(\\.\\.\\.panelOptions|presentation: 'modal')`);
      expect(NAV).toMatch(re);
    },
  );
});
