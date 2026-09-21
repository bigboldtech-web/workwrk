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

// The globalThis cache deliberately survives HMR, but it also survives
// `prisma generate`, so after a schema change the long-running dev server
// keeps serving an instance that predates the newest models and every
// route touching them 500s until someone manually restarts `pnpm dev`.
// Reuse the cached client only while it still has a delegate for every
// model the CURRENT generated client defines AND the same fields on each of
// them (an additive column on an existing model used to slip past the
// model-only check: the cached instance carried the old runtime data model
// and answered "Unknown argument" for the new column); otherwise build a
// fresh one (dev-only cost: one abandoned pool per schema regenerate).
function isCurrent(client: PrismaClient): boolean {
  return Object.keys(Prisma.ModelName).every(
    (m) => (m.charAt(0).toLowerCase() + m.slice(1)) in client,
  );
}

/** The model and field shape a client instance was generated with. */
function fingerprint(client: PrismaClient): string {
  const rdm = (client as unknown as { _runtimeDataModel?: { models?: Record<string, { fields?: unknown[] }> } })._runtimeDataModel;
  if (!rdm?.models) return "";
  return Object.entries(rdm.models).map(([m, v]) => `${m}:${v.fields?.length ?? 0}`).join(",");
}

function resolveClient(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (!cached) return createPrismaClient();
  const fresh = createPrismaClient();
  if (isCurrent(cached) && fingerprint(cached) === fingerprint(fresh)) {
    // Same shape: keep the warm pool, drop the one just built (it never connected).
    void fresh.$disconnect().catch(() => {});
    return cached;
  }
  return fresh;
}

export const prisma = resolveClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
