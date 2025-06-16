import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.js';

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  app.register(healthRoutes);
  return app;
}
