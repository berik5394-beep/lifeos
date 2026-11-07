import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Этап 5: один голос и без наложений. Структурные проверки — чтобы решения
 * не откатились незаметно (UI в jest не рендерим).
 */
const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

describe('один голос при входе', () => {
  const dash = src('app/(tabs)/index.tsx');
  it('цитата не звучит сама — только по кнопке', () => {
    expect(dash).not.toMatch(/useEffect\(\(\) => \{[^}]*Speech\.speak/);
    expect(dash).toMatch(/handleQuoteSpeak/);
  });
  it('утреннее приветствие отмечает день сразу, а не только по «закрыть»', () => {
    const hook = src('hooks/use-morning-greeting.ts');
    expect(hook).toMatch(/finally\([\s\S]{0,300}storage\.set\('lastGreetingDate'/);
  });
});

describe('робот не перекрывает инструмент', () => {
  it('у робота своя полоса внизу, контент над ней', () => {
    const page = src('app/home/tools-page.tsx');
    expect(page).toMatch(/bodyAboveRobot: \{ marginBottom: ROBOT_STRIP \}/);
  });
});

describe('без дубля шапки внутри дома', () => {
  it.each([
    ['app/(tabs)/tasks.tsx', 'Задачи'],
    ['app/(tabs)/goals.tsx', 'Цели на год'],
    ['app/(tabs)/habits.tsx', 'Привычки'],
    ['app/(tabs)/finance.tsx', 'Финансы'],
  ])('%s прячет «%s» в доме', (file, title) => {
    const s = src(file);
    const hits: number[] = [];
    for (let i = s.indexOf(`${title}</Text>`); i >= 0; i = s.indexOf(`${title}</Text>`, i + 1)) hits.push(i);
    expect(hits.length).toBeGreaterThan(0);
    // заголовок экрана (одно из вхождений) — под !inTools
    expect(hits.some((i) => /inTools/.test(s.slice(Math.max(0, i - 200), i)))).toBe(true);
  });
});

describe('вкладки инструментов живут, а не создаются заново', () => {
  const page = src('app/home/tools-page.tsx');
  it('открытые вкладки остаются смонтированными и прячутся', () => {
    expect(page).toMatch(/visited\.map/);
    expect(page).toMatch(/hidden: \{ display: 'none' \}/);
    expect(page).not.toMatch(/<Screen key=\{tab\} \/>/);
  });
  it('возврат после паузы — перечитать данные; окна поверх — только на активной', () => {
    expect(page).toMatch(/STALE_TAB_MS[\s\S]*bump\(\)/);
    expect(page).toMatch(/ToolActiveContext\.Provider value=\{k === tab\}/);
    const dash = src('app/(tabs)/index.tsx');
    expect(dash).toMatch(/visible=\{shouldShowGreeting && toolActive\}/);
  });
});

describe('канбан: писать можно в любой колонке', () => {
  const kb = src('app/kanban-board.tsx');
  it('строка «Новая задача» в каждой колонке, не только в «К выполнению»', () => {
    expect(kb).toMatch(/ListFooterComponent=\{\s*<TapToAdd hint="Новая задача" onSubmit=\{\(t\) => handleAddToColumn\(col\.id, t\)\} \/>/);
    expect(kb).not.toMatch(/col\.id === 'todo' \? <TapToAdd/);
  });
  it('колонка — по ширине экрана, листание ровно по колонке', () => {
    // Шаг листания = колонка + её поля; им же ездит переключатель колонок сверху.
    expect(kb).toMatch(/const step = columnWidth \+ spacing\.xs \* 2/);
    expect(kb).toMatch(/snapToInterval=\{step\}/);
    expect(kb).toMatch(/scrollTo\(\{ x: i \* step/);
    expect(kb).not.toMatch(/COLUMN_WIDTH = 280/);
  });
});
