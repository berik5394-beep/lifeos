import { defineWorkspace } from 'vitest/config';

// Дефолты тест-окружения для integration-проекта. Заданы ДО сборки конфига →
// попадают в process.env главного процесса → форвардятся в forked-воркеры →
// prisma singleton (читает env при импорте) их подхватывает. CI/реальный env
// переопределяет (??= не затирает уже заданное). Секреты — dummy, не настоящие.
process.env.DATABASE_URL ??= 'postgresql://lifeos:lifeos@localhost:5433/lifeos_test';
process.env.JWT_SECRET ??= 'test-jwt-secret-not-for-prod';
process.env.ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef';
process.env.NODE_ENV ??= 'test';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['src/**/*.test.ts'],
      exclude: ['src/**/*.it.test.ts', '**/node_modules/**'],
    },
  },
  {
    test: {
      name: 'integration',
      include: ['src/**/*.it.test.ts', 'test/**/*.it.test.ts'],
      globalSetup: ['test/integration/global-setup.ts'],
      setupFiles: ['test/integration/setup.ts'],
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      fileParallelism: false,
      testTimeout: 20000,
    },
  },
]);
