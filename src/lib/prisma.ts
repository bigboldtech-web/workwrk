import { Prisma, PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { reuseCachedClient } from "@/lib/prisma-cache";

const connectionString = process.env.DATABASE_URL!;

// One cached client PER COPY of the generated client, keyed by its class
// (lib/prisma-cache.ts has the whole why: the dev bundler loads a copy per
// server layer, and a client from one copy mis-binds another copy's
// Prisma.sql fragments).
const globalForPrisma = globalThis as unknown as {
  prismaByClass: WeakMap<object, PrismaClient> | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// The cache deliberately survives HMR, but it also survives
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

const cache = (globalForPrisma.prismaByClass ??= new WeakMap<object, PrismaClient>());

export const prisma = reuseCachedClient(
  cache,
  PrismaClient,
  createPrismaClient,
  // Same shape: keep the warm pool, drop the one just built (it never connected).
  (cached, fresh) => isCurrent(cached) && fingerprint(cached) === fingerprint(fresh),
  (unused) => { void unused.$disconnect().catch(() => {}); },
);

if (process.env.NODE_ENV !== "production") cache.set(PrismaClient, prisma);
