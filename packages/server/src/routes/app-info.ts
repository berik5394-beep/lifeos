import type { FastifyInstance } from 'fastify';

const CURRENT_VERSION = '1.0.0';
const MIN_SUPPORTED_VERSION = '1.0.0';

export async function appInfoRoutes(app: FastifyInstance): Promise<void> {
  // Version check — no auth required
  app.get('/app/version', async (request, reply) => {
    const clientVersion = (request.headers['x-app-version'] as string) || '0.0.0';
    const platform = (request.headers['x-platform'] as string) || 'unknown';

    const forceUpdate = isOlderThan(clientVersion, MIN_SUPPORTED_VERSION);

    return reply.send({
      currentVersion: clientVersion,
      latestVersion: CURRENT_VERSION,
      forceUpdate,
      updateUrl: platform === 'ios'
        ? 'https://apps.apple.com/app/lifeos/id0000000000'
        : 'https://play.google.com/store/apps/details?id=com.lifeos.app',
      changelog: forceUpdate
        ? 'Критические исправления безопасности'
        : 'Улучшения производительности и новые функции',
    });
  });

  // App config — non-sensitive config for the client
  app.get('/app/config', async (_request, reply) => {
    return reply.send({
      features: {
        voiceEnabled: true,
        arenaEnabled: true,
        sharedSpacesEnabled: true,
        maxFileUploadMB: 10,
      },
      maintenance: false,
      maintenanceMessage: null,
    });
  });
}

function isOlderThan(version: string, minVersion: string): boolean {
  const v = version.split('.').map(Number);
  const m = minVersion.split('.').map(Number);

  for (let i = 0; i < Math.max(v.length, m.length); i++) {
    const vv = v[i] ?? 0;
    const mv = m[i] ?? 0;
    if (vv < mv) return true;
    if (vv > mv) return false;
  }
  return false;
}
