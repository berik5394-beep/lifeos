import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Аудит HIGH: удаление аккаунта (требование Apple 5.1.1(v)) держится на
 * РУЧНОМ упорядоченном каскаде в /auth/delete-account, т.к. не все core-
 * модели имеют onDelete:Cascade в схеме. Риск: добавили новую user-owned
 * модель, забыли и cascade, и список → tx.user.delete() падает по FK для
 * любого юзера с этой моделью. Этот guard ловит регресс: КАЖДАЯ модель с
 * прямой связью `@relation(fields: [userId]` ОБЯЗАНА быть либо cascade-
 * нутой в схеме, либо удаляться в роуте. Зелёный = удаление не сломается.
 */
function camel(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

describe('account deletion coverage — каждая user-owned модель удаляется', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma/schema.prisma'),
    'utf-8',
  );
  const route = readFileSync(join(process.cwd(), 'src/routes/auth.ts'), 'utf-8');

  // Блоки моделей.
  const blocks = schema.split(/\nmodel\s+/).slice(1);
  const ownedUncovered: string[] = [];

  for (const block of blocks) {
    const name = block.split(/\s/)[0];
    if (name === 'User') continue;
    // Прямая связь с User по userId (owned). Игнорируем модели, связанные
    // иначе (ownerId/petId — их роут удаляет отдельно/через родителя).
    const ownsByUserId = /@relation\([^)]*fields:\s*\[userId\]/.test(block);
    if (!ownsByUserId) continue;
    // Покрыта, если: cascade в схеме на этой связи ИЛИ удаляется в роуте.
    const cascaded = /fields:\s*\[userId\][^)]*onDelete:\s*Cascade/.test(block) ||
      /onDelete:\s*Cascade[^)]*fields:\s*\[userId\]/.test(block);
    const accessor = camel(name);
    const inRoute = new RegExp(`tx\\.${accessor}\\.(deleteMany|delete)\\b`).test(route);
    if (!cascaded && !inRoute) ownedUncovered.push(name);
  }

  it('нет user-owned моделей без cascade И без удаления в роуте', () => {
    expect(ownedUncovered).toEqual([]);
  });

  it('роут удаляет User последним и в транзакции', () => {
    expect(route).toContain('tx.user.delete({ where: { id: userId } })');
    expect(route).toContain('$transaction');
  });
});
