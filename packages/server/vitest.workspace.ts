import { defineWorkspace } from 'vitest/config';

// Дефолты тест-окружения для integration-проекта. Заданы ДО сборки конфига →
// попадают в process.env главного процесса → форвардятся в forked-воркеры →
// prisma singleton (читает env при импорте) их подхватывает. CI/реальный env
// переопределяет (??= не затирает уже заданное). Секреты — dummy, не настоящие.
process.env.DATABASE_URL ??= 'postgresql://lifeos:lifeos@localhost:5433/lifeos_test';
process.env.JWT_SECRET ??= 'test-jwt-secret-not-for-prod';
process.env.ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef';
process.env.NODE_ENV ??= 'test';
// Тесты НИКОГДА не ходят в настоящую модель: рабочий ключ из .env (для живых
// прогонов) иначе включал реальные вызовы Claude — тесты становились платными,
// медленными и падали (разбор намерений отвечал по-настоящему). Перезаписываем.
process.env.CLAUDE_API_KEY = 'test-claude-key-not-real';
process.env.GROQ_API_KEY = 'test-groq-key-not-real';

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
