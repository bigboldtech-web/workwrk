/**
 * One-shot: delete the legacy "TheywrK" organization (and the user
 * admin@theywrk.com inside it) from production. Cascades remove the
 * org's seed data (departments etc.). All real customer data lives
 * in the "Cashkr" org and is untouched.
 *
 *   DATABASE_URL=... npx tsx scripts/delete-theywrk-org.ts --confirm
 *
 * Without --confirm the script just prints what it would do.
 */
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaNeon({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

const confirmed = process.argv.includes("--confirm");

async function main() {
  const org = await prisma.organization.findFirst({
    where: { slug: "theywrk" },
    select: {
      id: true, name: true, slug: true,
      _count: {
        select: {
          users: true, sops: true, kras: true, tasks: true,
          departments: true, kpis: true,
        },
      },
    },
  });
  if (!org) {
    console.log("No org with slug=theywrk. Nothing to delete.");
    return;
  }

  console.log(`Will delete org: ${org.name} (${org.id})`);
  console.log("Counts:", org._count);

  if (!confirmed) {
    console.log("\nDRY RUN — pass --confirm to actually delete.");
    return;
  }

  // Cascading FKs handle users/departments/etc. Org-level delete is
  // one statement.
  const deleted = await prisma.organization.delete({ where: { id: org.id } });
  console.log(`Deleted org: ${deleted.name}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
