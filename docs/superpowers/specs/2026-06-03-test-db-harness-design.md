# Тест-БД харнес для поведенческих тестов — Design (slice 1)

> Brainstormed + одобрено Berik 2026-06-03. Quality bar «умный Джарвис», YAGNI.
> Scope = SERVER ONLY (`packages/server`). Ноль изменений прод-бута.

## Проблема

Аудит 2026-06-03 показал: 124/210 тест-файлов сервера — это `readFileSync`+grep по
исходнику (структурные), а не поведенческие. Критичные пути **не проверяются в рантайме**:

- **auth** — login / JWT / ротация refresh / reuse-detection / delete-account;
- **route-хендлеры** — особенно **cross-user изоляция** (юзер A не должен видеть/менять
  данные юзера B);
- **деньги** — confirm-FSM (pending → confirm → ровно одна строка), атомарность гонки
  (Fix #1 этой сессии — закрыта в коде, но не доказана рантайм-тестом).

«Зелёное» сейчас НЕ означает «работает» для этих путей. Политика проекта — **zero
`vi.mock`**, поэтому единственный честный способ — **реальный Postgres в тестах**.

## Цель

Один тонкий, верифицируемый харнес: реальный pgvector-Postgres + vitest-проект
`integration`, по которому идут поведенческие тесты через `app.inject()` по настоящей
БД. Доказать его пользу на **3 высокоценных вертикалях** (auth-цикл, cross-user
изоляция, деньги-double-confirm). НЕ покрывать все роуты в этом слайсе.

## Не-цели (slice 1)

- Покрытие всех 24 роут-плагинов (последующие слайсы).
- Извлечение `buildApp()` из `index.ts` (прод-бут не трогаем; апгрейд верности — потом).
- Нагрузочные/конкурентные тесты сверх money-double-confirm.
- Транзакция-rollback изоляция (несовместима с prisma-singleton, см. ниже).

## Архитектура (одна фраза)

Фиксированный pgvector-контейнер на известном `DATABASE_URL` → vitest-проект
`integration` применяет миграции один раз (globalSetup) и `TRUNCATE`
между тестами → тесты собирают bare-Fastify из **реальных** роут-плагинов +
`@fastify/jwt` и бьют через `app.inject()` по настоящей БД. Юнит/структурные ~2200
живут в отдельном проекте `unit` **без БД** (офлайн, как сейчас, = текущий `npm test`).

## Решённые форки

| Форк | Решение | Почему |
|---|---|---|
| Провижн БД | docker-compose локально + GitHub `services` в CI | URL фиксирован и известен ДО старта воркеров → prisma singleton (читает `DATABASE_URL` при импорте) подхватывает его в каждом воркере без inject-гимнастики. CI-нативно. |
| Применение схемы | `prisma migrate deploy` (НЕ `db push`) | Воспроизводит реальную историю миграций (вкл. pgvector `CREATE EXTENSION`), ловит дрейф, идентично проду. Запускается из globalSetup через **`execFileNoThrow`** (codebase-политика: НЕ `exec`/shell). |
| Изоляция между тестами | `TRUNCATE … RESTART IDENTITY CASCADE` в `beforeEach` | Транзакция-rollback не годится: app зовёт prisma-singleton напрямую, не tx-клиент — обернуть прозрачно нельзя. Свежая БД на файл — слишком медленно. |
| Доступ к хендлерам | `buildTestApp(plugins[])` из плагинов, БЕЗ импорта `index.ts` | `index.ts` строит app на верхнем уровне + top-level `await app.listen()` + запуск Telegram-бота → импорт = реальный listen + бот. Роуты — чистые плагины (`authRoutes(app)`), JWT/cors регистрируются отдельно → тест собирает свой bare-Fastify. Ноль риска для прод-старта. |

## Компоненты (новые файлы)

Все пути относительно `packages/server/`.

| Файл | Ответственность | Интерфейс |
|---|---|---|
| `docker-compose.test.yml` | `pgvector/pgvector:pg16`, порт `5433`, БД `lifeos_test`, юзер/пароль `lifeos/lifeos` | `docker compose -f docker-compose.test.yml up -d` |
| `.env.test` | фикс `DATABASE_URL=postgresql://lifeos:lifeos@localhost:5433/lifeos_test` + dummy `JWT_SECRET`, `ENCRYPTION_KEY`, `NODE_ENV=test` | читается vitest-проектом `integration` |
| `vitest.workspace.ts` | два project'а: `unit` (всё кроме `**/*.it.test.ts`, без БД) и `integration` (только `**/*.it.test.ts`, globalSetup + setupFiles). **Vitest 2.1.9** → механизм = `vitest.workspace.ts` (inline `test.projects` — это v3, тут НЕ годится). `.env.test` грузится `dotenv` в шапке этого файла → `DATABASE_URL` в `process.env` главного процесса → форвардится в forked-воркеры → prisma singleton его читает | `npm test` = unit; `npm run test:it` = integration |
| `test/integration/global-setup.ts` | один раз на ран: применить `prisma migrate deploy` против тест-БД через `execFileNoThrow` | vitest `globalSetup` хук |
| `test/integration/reset-db.ts` | `resetDb(prisma)` — `TRUNCATE` всех таблиц `RESTART IDENTITY CASCADE` одним запросом (таблицы берём из `information_schema`, кроме `_prisma_migrations`) | вызывается из setupFile `beforeEach` |
| `test/integration/setup.ts` | setupFile: `beforeEach(() => resetDb(prisma))` для всех `*.it.test.ts` | vitest `setupFiles` (integration only) |
| `test/integration/build-test-app.ts` | `buildTestApp(plugins: FastifyPluginAsync[]): Promise<FastifyInstance>` — bare Fastify + `@fastify/jwt` (тот же секрет, что в `.env.test`) + переданные роут-плагины; helper `authHeader(app, userId)` подписывает JWT | используется каждым `*.it.test.ts` |

### `vitest.workspace.ts` — форма (Vitest 2.x, два project'а)

```ts
import { config } from 'dotenv';
import { defineWorkspace } from 'vitest/config';

// integration-проект требует тест-БД: грузим .env.test ДО сборки конфига,
// чтобы DATABASE_URL попал в process.env главного процесса → форвардится в
// forked-воркеры → prisma singleton (читает env при импорте) его подхватит.
config({ path: '.env.test' });

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['src/**/*.test.ts'],
      exclude: ['src/**/*.it.test.ts'],
    },
  },
  {
    test: {
      name: 'integration',
      include: ['src/**/*.it.test.ts', 'test/**/*.it.test.ts'],
      globalSetup: ['test/integration/global-setup.ts'],
      setupFiles: ['test/integration/setup.ts'],
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } }, // сериализуем — общая БД
      fileParallelism: false,
    },
  },
]);
```

`singleFork`/`fileParallelism:false` — потому что все integration-тесты делят одну БД и
`TRUNCATE` между тестами; параллельные воркеры конфликтовали бы. Точную форму
`defineWorkspace` vs `vitest.workspace.ts` (массив строк/конфигов) и совместимость
`--project` фильтра с 2.1.9 финально проверяем в плане через context7/локальный прогон.

### `buildTestApp` — форма

```ts
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import jwt from '@fastify/jwt';

export async function buildTestApp(
  plugins: FastifyPluginAsync[],
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET! });
  for (const p of plugins) await app.register(p);
  await app.ready();
  return app;
}
```

(Точная форма регистрации JWT и любых декораторов, которые ждут хендлеры —
сверяется с `index.ts` при реализации; если `authMiddleware`/роуты используют доп.
декоратор, регистрируем его тоже.)

## Три вертикали (доказательство, что харнес ловит баги)

### Вертикаль 1 — `auth.it.test.ts`
- register → 200 + токены;
- login верным паролем → 200; неверным → 401;
- `/auth/refresh` валидным refresh → новый access+refresh (ротация);
- **reuse-detection**: старый refresh ПОСЛЕ ротации → отказ (и сессия инвалидируется);
- `/auth/delete-account` → юзер реально удалён (привязка к Fix #4: юзер с
  `CorrectionLog`/`SkillDefinition` удаляется без FK-падения).

### Вертикаль 2 — `cross-user-isolation.it.test.ts`
- создаём юзеров A и B + по задаче;
- A с токеном A читает список → видит ТОЛЬКО свою задачу;
- A пытается `PATCH`/`DELETE` задачу B по id → 404/403, задача B НЕ изменена в БД;
- (тот же инвариант на 1 доп. ресурсе, напр. expense, если дёшево).

### Вертикаль 3 — `money-confirm.it.test.ts`
- ставим pending add_expense → confirm → ровно одна строка `Expense` с верной суммой;
- **double-confirm**: два параллельных confirm (`Promise.all`) → в БД ровно ОДНА
  строка `Expense` (рантайм-доказательство атомарности Fix #1).

## Поток данных

```
docker compose up (или CI service)
        ↓  фикс DATABASE_URL (.env.test / CI env)
vitest integration project старт
        ↓  globalSetup: prisma migrate deploy  (один раз, через execFileNoThrow)
для каждого *.it.test.ts (singleFork, последовательно):
        ↓  setup beforeEach: resetDb → TRUNCATE all
   тест: buildTestApp([authRoutes,…]) → app.inject({method,url,payload,headers})
        ↓  реальный хендлер → реальная prisma → реальная тест-БД
   assert: и HTTP-ответ, И строки в БД (через prisma.<model>.findMany)
```

## Обработка ошибок

- Контейнер не поднят / БД недоступна → globalSetup падает с понятным сообщением
  «Подними тест-БД: docker compose -f docker-compose.test.yml up -d» (fail-fast, не
  тихо). Юнит-`npm test` при этом НЕ затронут (отдельный проект, БД не нужна).
- `migrate deploy` падает (нет pgvector) → globalSetup пробрасывает ошибку как есть.
- `resetDb` оборачивает `TRUNCATE` в try и пробрасывает (тихий провал недопустим).

## CI

В `.github/workflows/ci.yml`, server-job:
```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    env: { POSTGRES_USER: lifeos, POSTGRES_PASSWORD: lifeos, POSTGRES_DB: lifeos_test }
    ports: ['5433:5432']
    options: >-
      --health-cmd "pg_isready -U lifeos" --health-interval 5s
      --health-timeout 5s --health-retries 10
```
+ шаг `Integration tests` → `DATABASE_URL=…5433… npm run test:it` (после `npm test`).
Юнит-`npm test` остаётся как есть → офлайн-разработчик без Docker гоняет ~2200.

## package.json scripts (packages/server)
```
"test":         "vitest run --project unit",
"test:db:up":   "docker compose -f docker-compose.test.yml up -d",
"test:db:down": "docker compose -f docker-compose.test.yml down -v",
"test:it":      "vitest run --project integration"
```
`test` явно фиксируется на проект `unit`, чтобы прод-CI `npm test` НЕ пытался тронуть БД.

## Верификация в текущей сессии (Docker запущен)

1. `npm run test:db:up` → контейнер поднят.
2. `npm run test:it` → 3 вертикали зелёные.
3. **Negative control**: временно ломаю изоляцию (убираю `where userId` в одном
   хендлере) ИЛИ атомарность → соответствующий тест КРАСНЕЕТ → откатываю → снова
   зелёный. Доказывает, что тесты ловят регресс, а не всегда зелёные.
4. `npx tsc --noEmit` чисто.
5. `npm test` (unit) — ~2200 остаются зелёными, БД не нужна.

## Риски и границы

- **Прод-бут не трогаем** — `buildTestApp` не импортирует `index.ts`. Единственная
  потеря верности: тест-app не включает глобальные плагины/хуки из `index.ts`
  (cors, rate-limit, error-handler). Для auth/изоляции/денег это приемлемо и даже
  желательно (изолируем юнит). Апгрейд до `buildApp()` — отдельный будущий слайс.
- `.env.test` содержит ТОЛЬКО dummy-секреты (не настоящие) — коммитится в репо.
- Тест-БД на порту 5433 (не 5432) — не конфликтует с локальным dev-Postgres.
- Rollout: коммит на шаг; push/deploy/CI-изменение — по явному слову Berik.
  (Этот слайс прод-код почти не трогает — только новые тест-файлы + конфиг + CI yaml.)
