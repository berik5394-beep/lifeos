import { execFileSync } from 'node:child_process';

// Vitest globalSetup: один раз на ран применяем реальную историю миграций к
// тест-БД (= прод-путь Railway). execFileSync — shell-free (без инъекций).
// Падение здесь = fail-fast с подсказкой, а не тихо-зелёный прогон.
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url || !url.includes('lifeos_test')) {
    throw new Error(
      `[integration] DATABASE_URL должен указывать на тест-БД (…/lifeos_test), ` +
        `получено: ${url ?? 'undefined'}. Подними её: npm run test:db:up`,
    );
  }
  try {
    // 1) migrate deploy — реальная история (создаёт pgvector extension + базу).
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      stdio: 'pipe',
      env: process.env,
    });
    // 2) db push — примиряет ДРЕЙФ: в schema.prisma есть колонки, которых нет в
    //    migrations/ (напр. User.timezone, добавленная исторически через db push).
    //    Сгенерированный Prisma client ждёт их → без этого шага .create() падает
    //    «column does not exist». Тест-БД эфемерна → --accept-data-loss безопасен.
    //    ПРИМЕЧАНИЕ: сам дрейф (migrations ≠ schema.prisma) — отдельная находка,
    //    латентный риск при пересоздании прод-БД из миграций. Чинится отдельной
    //    миграцией (prisma migrate diff), не здесь.
    execFileSync(
      'npx',
      ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
      { stdio: 'pipe', env: process.env },
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `[integration] применение схемы упало (migrate deploy + db push). ` +
        `Тест-БД поднята? (npm run test:db:up). Детали: ${detail}`,
    );
  }
}
