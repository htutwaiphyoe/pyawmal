import Fastify, { type FastifyInstance } from 'fastify';

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  return app;
}
