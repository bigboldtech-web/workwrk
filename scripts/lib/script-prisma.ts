// One PrismaClient for the migration scripts.
//
// `new PrismaClient()` with no arguments throws on Prisma 7: this project uses
// the driver adapter (`@prisma/adapter-pg`), so the client has to be handed a
// connection the same way `src/lib/prisma.ts` hands it one. Every script that
// learned that the hard way should learn it here instead.
//
// It reads DATABASE_URL and nothing else, which is what makes the command in
// scripts/MIGRATIONS.md ("DIRECT_URL= DATABASE_URL=… npx tsx …") the whole
// story about which database a script touches.

import { PrismaClient } from "../../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

export function scriptPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. A migration script must be told which database it is pointed at; see scripts/MIGRATIONS.md.",
    );
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Where the script is pointed, with the password removed, for the report header. */
export function databaseLabel(): string {
  const raw = process.env.DATABASE_URL ?? "";
  try {
    const url = new URL(raw);
    return `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}
