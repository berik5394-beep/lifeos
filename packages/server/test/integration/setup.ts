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
