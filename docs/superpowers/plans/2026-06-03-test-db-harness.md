# Тест-БД харнес — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or
> subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Дать серверу реальный-Postgres харнес для поведенческих тестов и доказать
его на 3 вертикалях (auth-ротация/reuse, cross-user изоляция, money double-confirm),
не трогая прод-бут.

**Architecture:** docker-compose pgvector (порт 5433) → vitest workspace из двух
project'ов: `unit` (без БД, текущие ~2200) и `integration` (`*.it.test.ts`, реальная
БД, `migrate deploy` в globalSetup, `TRUNCATE` в beforeEach). Тесты собирают
bare-Fastify из реальных роут-плагинов через `buildTestApp` (без импорта `index.ts`).

**Tech Stack:** Vitest 2.1.9 (workspace, `--project` фильтр), Fastify 5, @fastify/jwt 10,
Prisma 6, pgvector/pgvector:pg16, Docker.

**Rollout:** коммит на шаг (trailer `Co-Authored-By: Claude Opus 4.8 (1M context)`).
Push/deploy/CI-merge — ТОЛЬКО по явному слову Berik. Прод-код не меняется (только
`package.json` scripts + новые тест-файлы + ci.yml). Все пути относительно
`packages/server/`.

**Pinned факты (из explore):**
- JWT: payload `{ sub: userId }`; `authMiddleware` читает `decoded.sub` → `request.userId`.
- `index.ts` строит app на верхнем уровне + `app.listen()` + бот → импортировать НЕЛЬЗЯ.
- Роуты — плагины: `export async function authRoutes(app)`, `taskRoutes(app)` (внутри
  `app.addHook('preHandler', authMiddleware)`).
- `registerErrorHandler` из `src/middleware/error-handler.js` (нужен, чтобы брошенный
  `NotFoundError` стал 404, а не 500).
- `/auth/register` → 201 `{ accessToken, refreshToken, ... }`.
- `/auth/login` → 200 `{ accessToken, refreshToken, ... }`; неверный → 401.
- `/auth/refresh` → ротация; повторный старый refresh → 401 + `revokeAllUserTokens`.
- `/auth/delete-account` preHandler `[authMiddleware, validate(deleteAccountSchema)]`,
  body `{ password }`, bcrypt-проверка, `$transaction` удаляет `correctionLog`,
  `skillDefinition`, …, `user`; success → `{ message: 'Аккаунт удалён' }`.
- `tasks` DELETE `/tasks/:id` скоупится `where:{ id, userId }`, иначе `NotFoundError`.
- pending-actions: только `prismaPendingStore` (нет in-memory в проде) → integration
  тест автоматически бьёт по реальной БД. Экспорты: `setPendingAction(userId, action,
  filled?, text?)`, `takePendingAction(userId)`, `peekPendingAction`, `PENDING_TTL_MS`.
- `execFileNoThrow.ts` НЕ существует → globalSetup использует `execFileSync` (shell-free).
- `dotenv` НЕ установлен → тест-env задаём через `process.env.X ??=` в workspace-файле.

---

### Task 1: docker-compose тест-БД + npm scripts

**Files:**
- Create: `docker-compose.test.yml`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Создать `docker-compose.test.yml`**

```yaml
# Тест-Postgres с pgvector для поведенческих integration-тестов.
# Порт 5433 (не 5432) — не конфликтует с локальным dev-Postgres.
# Эфемерная БД: данные не маунтятся, down -v стирает всё.
services:
  test-db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: lifeos
      POSTGRES_PASSWORD: lifeos
      POSTGRES_DB: lifeos_test
    ports:
      - '5433:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U lifeos -d lifeos_test']
      interval: 3s
      timeout: 3s
      retries: 20
```

- [ ] **Step 2: Добавить scripts в `package.json`** (заменить строку `"test": "vitest run"`)

```json
    "test": "vitest run --project unit",
    "test:db:up": "docker compose -f docker-compose.test.yml up -d --wait",
    "test:db:down": "docker compose -f docker-compose.test.yml down -v",
    "test:it": "vitest run --project integration",
```

- [ ] **Step 3: Поднять контейнер и проверить здоровье**

Run: `npm run test:db:up`
Expected: контейнер `*-test-db-1` поднят и healthy (`--wait` блокирует до healthy).
Проверка: `docker compose -f docker-compose.test.yml ps` → STATUS содержит `healthy`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.test.yml package.json
git commit -m "test(harness): docker-compose pgvector test-db + npm scripts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: vitest workspace (unit + integration projects)

**Files:**
- Create: `vitest.workspace.ts`

**Контекст:** Vitest 2.1.9 → workspace-файл (inline `test.projects` — это v3). Два
project'а. Тест-env задаём через `??=` в шапке (CI/реальный env переопределяет).

- [ ] **Step 1: Создать `vitest.workspace.ts`**

```ts
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
```

- [ ] **Step 2: Проверить, что unit-проект гоняет текущие ~2200 без БД**

Run: `npx vitest run --project unit 2>&1 | tail -5`
Expected: PASS, число тестов ≈ как было (`npm test` ранее). БД не требуется.

- [ ] **Step 3: Проверить, что integration-проект резолвится (0 тестов пока ок)**

Run: `npx vitest run --project integration 2>&1 | tail -8`
Expected: либо «No test files found» (зелёный), либо упадёт в globalSetup — это ок,
globalSetup ещё не создан (Task 3). Если ошибка про отсутствующий globalSetup —
ожидаемо, переходим к Task 3.

- [ ] **Step 4: Commit**

```bash
git add vitest.workspace.ts
git commit -m "test(harness): vitest workspace — unit (no-DB) + integration projects

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: globalSetup — migrate deploy против тест-БД

**Files:**
- Create: `test/integration/global-setup.ts`

- [ ] **Step 1: Создать `test/integration/global-setup.ts`**

```ts
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
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      stdio: 'pipe',
      env: process.env,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `[integration] prisma migrate deploy упал. Тест-БД поднята? ` +
        `(npm run test:db:up). Детали: ${detail}`,
    );
  }
}
```

- [ ] **Step 2: Добавить временный smoke-тест `test/integration/smoke.it.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';

describe('integration smoke', () => {
  it('подключается к тест-БД и видит применённую схему', async () => {
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.$queryRaw<Array<{ one: number }>>`SELECT 1 as one`;
      expect(rows[0].one).toBe(1);
      // Таблица из миграций существует → schema применена.
      const users = await prisma.user.count();
      expect(typeof users).toBe('number');
    } finally {
      await prisma.$disconnect();
    }
  });
});
```

- [ ] **Step 3: Прогнать integration с поднятой БД**

Run: `npm run test:db:up && npm run test:it 2>&1 | tail -15`
Expected: PASS 1 тест (smoke). Доказывает: globalSetup применил миграции (вкл.
pgvector) + prisma коннектится к тест-БД.

- [ ] **Step 4: Commit** (smoke оставляем — он дёшев и сторожит коннект/миграции)

```bash
git add test/integration/global-setup.ts test/integration/smoke.it.test.ts
git commit -m "test(harness): globalSetup migrate deploy + connect smoke

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: resetDb + setup (TRUNCATE между тестами)

**Files:**
- Create: `test/integration/reset-db.ts`
- Create: `test/integration/setup.ts`
- Test: `test/integration/truncate.it.test.ts` (временный, проверяет изоляцию)

- [ ] **Step 1: Создать `test/integration/reset-db.ts`**

```ts
import type { PrismaClient } from '@prisma/client';

// Чистим все public-таблицы между тестами одним TRUNCATE … RESTART IDENTITY
// CASCADE. Имена тянем из information_schema, кроме служебной _prisma_migrations
// (её трогать нельзя — иначе пришлось бы migrate на каждый тест).
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}
```

- [ ] **Step 2: Создать `test/integration/setup.ts`** (setupFile — beforeEach на все it-тесты)

```ts
import { afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resetDb } from './reset-db.js';

// Один PrismaClient на воркер (singleFork → один воркер на весь integration-ран).
const prisma = new PrismaClient();

beforeEach(async () => {
  await resetDb(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 3: Написать падающий тест изоляции `test/integration/truncate.it.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Два теста: первый вставляет юзера, второй ОБЯЗАН видеть пустую таблицу.
// Если TRUNCATE-beforeEach не работает — второй тест увидит юзера из первого.
describe('truncate isolation', () => {
  it('тест A: вставляет юзера', async () => {
    await prisma.user.create({
      data: {
        email: 'a@truncate.test',
        name: 'A',
        passwordHash: 'x',
      },
    });
    expect(await prisma.user.count()).toBe(1);
  });

  it('тест B: видит пустую таблицу (beforeEach почистил)', async () => {
    expect(await prisma.user.count()).toBe(0);
  });
});
```

- [ ] **Step 4: Прогнать — оба зелёные (доказывает TRUNCATE-изоляцию)**

Run: `npm run test:it 2>&1 | tail -15`
Expected: PASS (smoke + 2 truncate-теста). Если тест B падает на `toBe(0)` →
setupFile не подключён; проверить `setupFiles` в workspace.

- [ ] **Step 5: Commit**

```bash
git add test/integration/reset-db.ts test/integration/setup.ts test/integration/truncate.it.test.ts
git commit -m "test(harness): resetDb TRUNCATE + beforeEach setup + isolation proof

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: buildTestApp — bare Fastify из реальных плагинов

**Files:**
- Create: `test/integration/build-test-app.ts`
- Test: `test/integration/build-test-app.it.test.ts` (временный)

- [ ] **Step 1: Создать `test/integration/build-test-app.ts`**

```ts
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import jwt from '@fastify/jwt';
import { registerErrorHandler } from '../../src/middleware/error-handler.js';

// Собираем настоящий Fastify из реальных роут-плагинов БЕЗ импорта index.ts
// (тот на верхнем уровне делает listen + запуск бота). Регистрируем только то,
// что нужно хендлерам: @fastify/jwt (тот же секрет) + error-handler (чтобы
// брошенный NotFoundError стал 404, а не 500). Глобальные cors/rate-limit
// намеренно опускаем — изолируем хендлеры.
export async function buildTestApp(
  plugins: FastifyPluginAsync[],
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET! });
  registerErrorHandler(app);
  for (const p of plugins) await app.register(p);
  await app.ready();
  return app;
}
```

- [ ] **Step 2: Написать тест `test/integration/build-test-app.it.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildTestApp } from './build-test-app.js';
import { taskRoutes } from '../../src/routes/tasks.js';

const app = await buildTestApp([taskRoutes]);
afterAll(() => app.close());

describe('buildTestApp', () => {
  it('защищённый роут без токена → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/tasks' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 3: Прогнать**

Run: `npm run test:it 2>&1 | tail -15`
Expected: PASS. Доказывает: реальный роут-плагин + authMiddleware + jwt работают в
изолированном app.

- [ ] **Step 4: Commit**

```bash
git add test/integration/build-test-app.ts test/integration/build-test-app.it.test.ts
git commit -m "test(harness): buildTestApp from real route plugins (no index.ts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Вертикаль 1 — auth.it.test.ts (ротация + reuse + delete)

**Files:**
- Test: `src/routes/auth.it.test.ts`

- [ ] **Step 1: Написать поведенческий тест**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { authRoutes } from './auth.js';

const prisma = new PrismaClient();
const app = await buildTestApp([authRoutes]);
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const reg = (email: string) =>
  app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, name: 'T', password: 'Str0ng!Passw0rd' },
  });

describe('auth поведенчески', () => {
  it('register → 201 + токены', async () => {
    const r = await reg('reg@a.test');
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b.accessToken).toBeTruthy();
    expect(b.refreshToken).toBeTruthy();
  });

  it('login верным паролем → 200; неверным → 401', async () => {
    await reg('login@a.test');
    const ok = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'login@a.test', password: 'Str0ng!Passw0rd' },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'login@a.test', password: 'wrong' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('refresh ротирует, а повторный СТАРЫЙ refresh → 401 + все токены отозваны', async () => {
    const r0 = (await reg('rot@a.test')).json();
    const rot = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: r0.refreshToken },
    });
    expect(rot.statusCode).toBe(200);
    const r1 = rot.json();
    expect(r1.refreshToken).toBeTruthy();
    expect(r1.refreshToken).not.toBe(r0.refreshToken);

    // reuse старого → 401
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: r0.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);

    // reuse-detection отозвал ВСЕ → новый r1 тоже больше не работает
    const after = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: r1.refreshToken },
    });
    expect(after.statusCode).toBe(401);
  });

  it('delete-account удаляет юзера С CorrectionLog/SkillDefinition без FK-падения (Fix #4)', async () => {
    const r = (await reg('del@a.test')).json();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'del@a.test' },
    });
    // Создаём именно те модели, что Fix #4 добавил в каскад.
    await prisma.correctionLog.create({
      data: { userId: user.id, axis: 'energy', direction: 'up', reason: 't' },
    });
    await prisma.skillDefinition.create({
      data: { userId: user.id, name: 'tskill', description: 'd', steps: [] },
    });

    const del = await app.inject({
      method: 'POST',
      url: '/auth/delete-account',
      headers: { authorization: `Bearer ${r.accessToken}` },
      payload: { password: 'Str0ng!Passw0rd' },
    });
    expect(del.statusCode).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.correctionLog.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.skillDefinition.count({ where: { userId: user.id } })).toBe(0);
  });
});
```

- [ ] **Step 2: Прогнать**

Run: `npm run test:it 2>&1 | tail -25`
Expected: PASS все 4. Если `correctionLog`/`skillDefinition` `.create` упадёт по схеме
(поля иначе названы) — поправить `data` под реальную модель (свериться:
`grep -A8 "model CorrectionLog" prisma/schema.prisma` и `model SkillDefinition`).

- [ ] **Step 3: Commit**

```bash
git add src/routes/auth.it.test.ts
git commit -m "test(auth): behavioral — register/login/refresh-rotation/reuse/delete-account

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Вертикаль 2 — cross-user изоляция

**Files:**
- Test: `src/routes/cross-user-isolation.it.test.ts`

- [ ] **Step 1: Написать тест**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildTestApp } from '../../test/integration/build-test-app.js';
import { authRoutes } from './auth.js';
import { taskRoutes } from './tasks.js';

const prisma = new PrismaClient();
const app = await buildTestApp([authRoutes, taskRoutes]);
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function userWithToken(email: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, name: 'U', password: 'Str0ng!Passw0rd' },
  });
  return r.json().accessToken as string;
}

describe('cross-user изоляция задач', () => {
  it('B не видит и не может удалить задачу A', async () => {
    const tokenA = await userWithToken('iso-a@a.test');
    const tokenB = await userWithToken('iso-b@a.test');

    const created = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { title: 'A-секрет', category: 'personal', priority: 'medium', date: '2026-06-03' },
    });
    expect(created.statusCode).toBeLessThan(300);
    const taskId = created.json().id as string;

    // B читает список → НЕ видит задачу A
    const listB = await app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    const idsB = (listB.json() as Array<{ id: string }>).map((t) => t.id);
    expect(idsB).not.toContain(taskId);

    // B пытается удалить задачу A → отказ (404/403), и строка A ЦЕЛА в БД
    const delB = await app.inject({
      method: 'DELETE',
      url: `/tasks/${taskId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([403, 404]).toContain(delB.statusCode);
    expect(await prisma.task.findUnique({ where: { id: taskId } })).not.toBeNull();

    // A удаляет свою → ок
    const delA = await app.inject({
      method: 'DELETE',
      url: `/tasks/${taskId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(delA.statusCode).toBeLessThan(300);
  });
});
```

- [ ] **Step 2: Прогнать**

Run: `npm run test:it 2>&1 | tail -20`
Expected: PASS. Если POST /tasks вернёт иной success-код/тело — свериться с
`sed -n '111,154p' src/routes/tasks.ts` и поправить payload/ожидания.

- [ ] **Step 3: Commit**

```bash
git add src/routes/cross-user-isolation.it.test.ts
git commit -m "test(routes): behavioral cross-user isolation — B cannot read/delete A's task

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Вертикаль 3 — money double-confirm (атомарность Fix #1)

**Files:**
- Test: `src/services/pending-actions.it.test.ts`

- [ ] **Step 1: Написать тест (service-level, реальная БД, без LLM)**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  setPendingAction,
  takePendingAction,
} from './pending-actions.js';

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

async function makeUser(email: string): Promise<string> {
  const u = await prisma.user.create({
    data: { email, name: 'M', passwordHash: 'x' },
  });
  return u.id;
}

describe('pending-actions атомарность по РЕАЛЬНОЙ БД (Fix #1)', () => {
  it('два параллельных take → действие достаётся ровно один раз', async () => {
    const userId = await makeUser('money-race@a.test');
    await setPendingAction(userId, 'add_expense', { amount: 5000, category: 'food' }, 'трата 5000');

    const [a, b] = await Promise.all([
      takePendingAction(userId),
      takePendingAction(userId),
    ]);

    const winners = [a, b].filter((x) => x !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.action).toBe('add_expense');
    // PendingAction в БД больше нет (consume прошёл).
    expect(await takePendingAction(userId)).toBeNull();
  });

  it('повторный take после consume → null (не дубль)', async () => {
    const userId = await makeUser('money-once@a.test');
    await setPendingAction(userId, 'add_income', { amount: 1000 }, 'доход');
    expect(await takePendingAction(userId)).not.toBeNull();
    expect(await takePendingAction(userId)).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать**

Run: `npm run test:it 2>&1 | tail -20`
Expected: PASS. Если `setPendingAction` сигнатура иная (порядок/имена аргументов) —
свериться с `sed -n '99,156p' src/services/pending-actions.ts` и поправить вызов.

- [ ] **Step 3: Commit**

```bash
git add src/services/pending-actions.it.test.ts
git commit -m "test(money): behavioral double-confirm atomicity on real DB (Fix #1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Negative control + полная верификация

**Files:** нет новых (временная правка откатывается)

- [ ] **Step 1: Negative control — доказать, что изоляционный тест ЛОВИТ регресс**

Временно в `src/routes/tasks.ts` DELETE-хендлере заменить
`where: { id, userId: request.userId }` на `where: { id }` (убрать скоуп).
Run: `npm run test:it -- cross-user 2>&1 | tail -15`
Expected: тест Task 7 КРАСНЕЕТ (B смог удалить задачу A).

- [ ] **Step 2: Откатить правку немедленно**

Run: `git checkout src/routes/tasks.ts`
Run: `npm run test:it -- cross-user 2>&1 | tail -8`
Expected: снова PASS. (Negative control НЕ коммитим — только доказали, что тест жив.)

- [ ] **Step 3: tsc + оба проекта зелёные**

Run: `npx tsc --noEmit` → Expected: чисто.
Run: `npm test 2>&1 | tail -5` → Expected: unit ~2200 PASS, БД не нужна.
Run: `npm run test:it 2>&1 | tail -10` → Expected: все integration PASS.

- [ ] **Step 4: Independent review + commit (если правок не было — пропустить commit)**

Если Step 1-2 что-то оставили — `git status` чистый кроме намеренного. Зафиксировать
не требуется (negative control не коммитим).

---

### Task 10: CI-проводка (pgvector service + test:it шаг)

**Files:**
- Modify: `.github/workflows/ci.yml` (server job)

**Контекст:** добавляем pg-сервис с pgvector + шаг integration ПОСЛЕ юнит-тестов.
Юнит `npm test` остаётся (офлайн-разработчик без Docker им пользуется).

- [ ] **Step 1: В `server` job добавить `services` (на уровне job, рядом с `runs-on`)**

```yaml
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: lifeos
          POSTGRES_PASSWORD: lifeos
          POSTGRES_DB: lifeos_test
        ports:
          - '5433:5432'
        options: >-
          --health-cmd "pg_isready -U lifeos -d lifeos_test"
          --health-interval 5s --health-timeout 5s --health-retries 10
```

- [ ] **Step 2: После шага `Tests` (`npm test`) добавить шаг integration**

```yaml
      - name: Integration tests (real DB)
        run: npm run test:it
        env:
          DATABASE_URL: postgresql://lifeos:lifeos@localhost:5433/lifeos_test
          JWT_SECRET: test-jwt-secret-not-for-prod
          ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef'
          NODE_ENV: test
```

- [ ] **Step 3: Провалидировать yaml локально**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
Expected: `yaml ok`. (Реальный прогон — только в GitHub Actions после push.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: pgvector service + integration test step (test:it)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (заполняется при написании плана)

- **Spec coverage:** docker-compose (T1), vitest workspace (T2), globalSetup migrate
  (T3), resetDb/setup truncate (T4), buildTestApp (T5), 3 вертикали (T6/T7/T8),
  negative control + verify (T9), CI (T10). Все секции спеки покрыты.
- **Placeholder scan:** конкретные значения/код в каждом шаге; «свериться с …» —
  это fallback-инструкции на случай расхождения схемы, не плейсхолдеры.
- **Type consistency:** `buildTestApp(plugins: FastifyPluginAsync[])` единообразно
  во всех тестах; `setPendingAction(userId, action, filled, text)` / `takePendingAction(userId)`
  — по факту экспортов. CorrectionLog/SkillDefinition `data` — fallback-свёрка в T6
  на случай иных полей.
- **Открытый риск:** точные `data`-поля `CorrectionLog`/`SkillDefinition` и
  success-код POST /tasks свериваются прямо в шагах (grep-инструкции даны) — это
  снимается при реализации, не блокирует.

## Verification gate (вся фича)
1. `npm run test:db:up` → healthy.
2. `npm run test:it` → smoke + truncate(2) + buildTestApp(1) + auth(4) + isolation(1)
   + money(2) — все зелёные.
3. Negative control: ломаю скоуп → isolation красный → откат → зелёный.
4. `npx tsc --noEmit` чисто; `npm test` unit ~2200 зелёные (без БД).
5. CI yaml валиден.
