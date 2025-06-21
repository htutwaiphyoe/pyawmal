import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { PlaceholderSchema as _Placeholder } from '@pyawmal/shared';
import { dbPlugin } from './plugins/db.js';
import { healthRoutes } from './routes/health.js';
import { dbPingRoutes } from './routes/db-ping.js';

void _Placeholder;

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(process.env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty' } }
        : {}),
    },
    genReqId: () => randomUUID(),
  });
  app.register(dbPlugin);
  app.register(healthRoutes);
  app.register(dbPingRoutes);
  return app;
}
