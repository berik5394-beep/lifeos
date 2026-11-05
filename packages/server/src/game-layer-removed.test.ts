import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Робот-эпик, Часть 1 (2026-11-05, решение Berik «удалить полностью»): старый
 * игровой слой (питомец, Арена/бои/челленджи, ачивки, серверные темы) удалён
 * с сервера и из схемы. Гард: не возвращается.
 */
const SRC = join(process.cwd(), 'src');

function files(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, acc);
    else if (n.endsWith('.ts') && !n.includes('.test.')) acc.push(p);
  }
  return acc;
}

describe('игровой слой удалён с сервера', () => {
  it.each([
    'routes/pet.ts',
    'routes/achievements.ts',
    'routes/arena.ts',
    'routes/challenge.ts',
    'services/items-catalog.ts',
    'services/pet-streak-service.ts',
  ])('src/%s отсутствует', (f) => {
    expect(existsSync(join(SRC, f))).toBe(false);
  });

  it('в коде нет обращений к слою', () => {
    const pattern = /prisma\.(pet|petItem|achievement|arenaProfile|battle|challenge)\b|tx\.(pet|petItem|achievement|arenaProfile|battle|challenge)\b|\baddXP\b|runPetStreakSweep|verify-exercise/;
    const scripts = join(process.cwd(), 'scripts');
    const all = [...files(SRC), ...(existsSync(scripts) ? files(scripts) : [])];
    const offenders = all.filter((f) => pattern.test(readFileSync(f, 'utf-8'))).map((f) => f.replace(SRC + '/', ''));
    expect(offenders).toEqual([]);
  });

  it('схема без моделей слоя + есть миграция удаления таблиц', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
    for (const m of ['Pet', 'PetItem', 'Achievement', 'ArenaProfile', 'Battle', 'Challenge']) {
      expect(schema).not.toMatch(new RegExp(`^model ${m} \\{`, 'm'));
    }
    const migs = readdirSync(join(process.cwd(), 'prisma/migrations'));
    const drop = migs.find((m) => m.endsWith('_drop_game_layer'));
    expect(drop).toBeTruthy();
    const sql = readFileSync(join(process.cwd(), 'prisma/migrations', drop!, 'migration.sql'), 'utf-8');
    for (const t of ['Pet', 'PetItem', 'Achievement', 'ArenaProfile', 'Battle', 'Challenge']) {
      expect(sql).toMatch(new RegExp(`DROP TABLE IF EXISTS "${t}"`));
    }
  });
});
