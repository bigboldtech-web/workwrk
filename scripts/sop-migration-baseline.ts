/**
 * Read-only pre-migration baseline. Lists what's in the DB right now
 * so we can compare before/after the SOP folder unification.
 *
 *   DATABASE_URL=... npx tsx scripts/sop-migration-baseline.ts
 *
 * Safe to run repeatedly — never writes.
 */
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaNeon({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

async function main() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const totalSops = await prisma.sOP.count();
  const totalFolders = await prisma.sOPFolder.count();
  const totalCats = await prisma.sOPCategory.count();
  const totalSubs = await prisma.sOPSubcategory.count();

  // (category, subcategory) groupBy — what the data migration will turn
  // into folders.
  const distinctPairs = await prisma.sOP.groupBy({
    by: ["organizationId", "category", "subcategory"],
    where: { category: { not: null } },
    _count: { _all: true },
  });

  // SOPs that already have a folderId (will be left alone by the
  // migration).
  const alreadyFoldered = await prisma.sOP.count({ where: { folderId: { not: null } } });
  const noCategory = await prisma.sOP.count({ where: { category: null, folderId: null } });

  console.log("=== Pre-migration baseline ===\n");
  console.log(`Orgs:                       ${orgs.length}`);
  console.log(`Total SOPs:                 ${totalSops}`);
  console.log(`  · already in a folder:    ${alreadyFoldered}`);
  console.log(`  · w/ category, no folder: ${totalSops - alreadyFoldered - noCategory}`);
  console.log(`  · no category, no folder: ${noCategory}`);
  console.log(`Existing SOP folders:       ${totalFolders}`);
  console.log(`Existing SOPCategory rows:  ${totalCats}`);
  console.log(`Existing SOPSubcategory:    ${totalSubs}`);
  console.log(`Distinct (cat, sub) pairs:  ${distinctPairs.length}`);
  console.log();

  // Per-org breakdown. Useful when one org dominates the data.
  for (const o of orgs) {
    const sopCount = await prisma.sOP.count({ where: { organizationId: o.id } });
    if (sopCount === 0) continue;
    const orgPairs = distinctPairs.filter((p) => p.organizationId === o.id);
    console.log(`[${o.name}] ${sopCount} SOPs, ${orgPairs.length} distinct (category, subcategory) pairs`);
    for (const p of orgPairs.slice(0, 10)) {
      const sub = p.subcategory ? ` / ${p.subcategory}` : "";
      console.log(`    · ${p.category}${sub} → ${p._count._all} SOP(s)`);
    }
    if (orgPairs.length > 10) console.log(`    ... and ${orgPairs.length - 10} more`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
