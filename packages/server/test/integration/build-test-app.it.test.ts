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
