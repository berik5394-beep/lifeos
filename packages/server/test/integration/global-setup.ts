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
    // migrate deploy воспроизводит ПОЛНУЮ схему: миграция reconcile_schema_drift
    // (20260603000000) примирила исторический db-push-дрейф, поэтому отдельный
    // db push больше НЕ нужен — migrate deploy один даёт схему = schema.prisma.
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      stdio: 'pipe',
      env: process.env,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `[integration] применение схемы упало (migrate deploy + db push). ` +
        `Тест-БД поднята? (npm run test:db:up). Детали: ${detail}`,
    );
  }
}
