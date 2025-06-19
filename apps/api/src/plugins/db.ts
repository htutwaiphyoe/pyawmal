import fp from 'fastify-plugin';
import { getPrisma, type PrismaClient } from '@pyawmal/db';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export const dbPlugin = fp(async (app) => {
  const prisma = getPrisma();
  app.decorate('prisma', prisma);
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
