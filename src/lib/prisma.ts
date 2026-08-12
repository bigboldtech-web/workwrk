import { Prisma, PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// The globalThis cache deliberately survives HMR — but it also survives
// `prisma generate`, so after a schema change the long-running dev server
// keeps serving an instance that predates the newest models and every
// route touching them 500s until someone manually restarts `pnpm dev`.
// Reuse the cached client only while it still has a delegate for every
// model the CURRENT generated client defines; otherwise build a fresh one
// (dev-only cost: one abandoned pool per schema regenerate).
function isCurrent(client: PrismaClient): boolean {
  return Object.keys(Prisma.ModelName).every(
    (m) => (m.charAt(0).toLowerCase() + m.slice(1)) in client,
  );
}

export const prisma =
  globalForPrisma.prisma && isCurrent(globalForPrisma.prisma)
    ? globalForPrisma.prisma
    : createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
