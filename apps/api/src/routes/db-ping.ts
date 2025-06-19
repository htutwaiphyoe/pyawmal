import type { FastifyInstance } from 'fastify';

export async function dbPingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/db-ping', async (req, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { db: 'ok' };
    } catch (err) {
      req.log.error(err, 'db-ping failed');
      return reply.code(503).send({ db: 'error' });
    }
  });
}
