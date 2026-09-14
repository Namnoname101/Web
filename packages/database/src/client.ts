import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

const prismaGlobal = globalThis as typeof globalThis & {
  __personalSchedulePrisma?: PrismaClient;
};

let processPrismaClient = prismaGlobal.__personalSchedulePrisma;

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to initialize Prisma.");
  }

  return new PrismaClient({
    // Prisma's pg adapter sends JavaScript dates as PostgreSQL timestamp
    // parameters. Pinning every pooled connection to UTC prevents the server's
    // regional timezone from reinterpreting an instant on write/read.
    adapter: new PrismaPg({ connectionString, options: "-c timezone=UTC" }),
  });
}

/**
 * Reuses the client during local hot reloads while keeping one process-local
 * connection pool in production.
 */
export function getPrismaClient(): PrismaClient {
  processPrismaClient ??= createPrismaClient();

  if (process.env.NODE_ENV !== "production") {
    prismaGlobal.__personalSchedulePrisma = processPrismaClient;
  }

  return processPrismaClient;
}
