import { afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resetDb } from './reset-db.js';
import { prisma as appPrisma } from '../../src/lib/prisma.js';

// setupFiles исполняются в модульном контексте КАЖДОГО тест-файла (vitest
// изолирует модули даже в singleFork) → и этот клиент, и синглтон приложения
// `src/lib/prisma.ts` создаются заново на каждый файл. Закрываем ОБА в
// afterAll: иначе пулы приложения копились за прогон (13→42→88 соединений)
// и Postgres упирался в max_connections=100 — «too many clients already»
// валило случайные файлы в зависимости от порядка (2026-11-05).
const prisma = new PrismaClient();

beforeEach(async () => {
  await resetDb(prisma);
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), appPrisma.$disconnect()]);
});
