import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    ok: true,
    version: process.env.npm_package_version ?? '0.0.0',
    commit: process.env.GIT_COMMIT ?? 'dev',
  }));
}
