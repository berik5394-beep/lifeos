import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Робот-эпик, Часть 1 (2026-11-05, решение Berik «удалить полностью»): старый
 * игровой слой — питомец LifePet, Арена/бои/челленджи, ачивки — удалён из
 * приложения. Его место займёт робот с комнатой. Гард: слой не возвращается.
 */
const ROOT = join(__dirname, '../..');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '__tests__', 'ios', 'android', '.expo', 'dist'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

describe('игровой слой удалён (питомец, Арена, ачивки)', () => {
  it.each([
    'app/pet.tsx',
    'app/arena.tsx',
    'app/battle-screen.tsx',
    'app/character-select.tsx',
    'app/achievements.tsx',
    'app/swipe-home.tsx',
    'stores/pet-store.ts',
    'stores/achievement-store.ts',
    'components/shared/pet-avatar.tsx',
    'components/characters',
    'constants/characters',
  ])('%s отсутствует', (p) => {
    expect(existsSync(join(ROOT, p))).toBe(false);
  });

  it('в коде приложения нет ссылок на слой', () => {
    const offenders: string[] = [];
    const pattern = /usePetStore|useAchievementStore|PetAvatar|['"`]\/(pet|arena|challenge|achievements|themes)\b|navigate\(['"](Pet|Arena|Achievements|BattleScreen|SwipeHome|character-select)['"]/;
    for (const f of sourceFiles(ROOT)) {
      if (pattern.test(readFileSync(f, 'utf-8'))) offenders.push(f.replace(ROOT + '/', ''));
    }
    expect(offenders).toEqual([]);
  });

  it('3D-зависимости убраны', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const dep of ['three', '@react-three/fiber', '@react-three/drei', 'expo-gl', 'expo-three', '@types/three']) {
      expect(all[dep]).toBeUndefined();
    }
  });
});
