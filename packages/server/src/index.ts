import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { authRoutes } from './routes/auth.js';
import { taskRoutes } from './routes/tasks.js';
import { habitRoutes } from './routes/habits.js';
import { goalRoutes } from './routes/goals.js';
import { financeRoutes } from './routes/finance.js';
import { stepRoutes } from './routes/steps.js';
import { voiceRoutes } from './routes/voice.js';
import { journalRoutes } from './routes/journal.js';
import { eventRoutes } from './routes/events.js';
import { importRoutes } from './routes/import.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(jwt, {
  secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
});

app.get('/health', async () => {
  return { status: 'ok' };
});

await app.register(authRoutes);
await app.register(taskRoutes);
await app.register(habitRoutes);
await app.register(goalRoutes);
await app.register(financeRoutes);
await app.register(stepRoutes);
await app.register(voiceRoutes);
await app.register(journalRoutes);
await app.register(eventRoutes);
await app.register(importRoutes);

const start = async (): Promise<void> => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
