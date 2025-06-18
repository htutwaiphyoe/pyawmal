import { PrismaClient } from '@prisma/client';

let prismaInstance: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!prismaInstance) prismaInstance = new PrismaClient();
  return prismaInstance;
}

export type { PrismaClient } from '@prisma/client';
