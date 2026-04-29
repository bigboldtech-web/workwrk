/**
 * Phase 1 data migration: collapse `SOP.category` / `SOP.subcategory`
 * (free-form strings) into the new SOPFolder tree.
 *
 * Strictly additive — DOES NOT delete or null any existing column or
 * row. The legacy `category` / `subcategory` strings stay on SOP for
 * backwards compatibility and rollback. Old SOPCategory /
 * SOPSubcategory tables are untouched.
 *
 * What it does:
 *   1. For each org, walk every SOP that has a category set.
 *   2. Find or create a top-level folder named after the category.
 *      If the SOP also has a subcategory, find or create a child
 *      folder under it.
 *   3. If the SOP has no folderId yet, point it at the deepest
 *      matching folder. SOPs that already have a folderId are left
 *      alone (we trust manual placement).
 *
 * Idempotent: running twice is a no-op. Re-runnable any time.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/migrate-sop-categories-to-folders.ts --dry-run
 *   DATABASE_URL=... npx tsx scripts/migrate-sop-categories-to-folders.ts
 *   DATABASE_URL=... npx tsx scripts/migrate-sop-categories-to-folders.ts --org=<orgId>
 *
 * Flags:
 *   --dry-run    Print the plan; don't touch the database.
 *   --org=<id>   Limit to a single organization (useful for pilot).
 *   --verbose    Per-SOP log line.
 */
import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const verbose = argv.includes("--verbose");
const orgArg = argv.find((a) => a.startsWith("--org="));
const orgFilter = orgArg ? orgArg.split("=")[1] : null;

// Deterministic color picker so the same category name always lands on
// the same folder color across orgs. Keeps re-runs stable.
const PALETTE = [
  "#d4ff2e", "#7c3aed", "#0ea5e9", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#06b6d4", "#84cc16", "#f97316",
];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

interface Counts {
  orgs: number;
  sopsScanned: number;
  sopsLinked: number;
  foldersCreated: number;
  childFoldersCreated: number;
  alreadyFoldered: number;
  skippedNoCategory: number;
}

async function findOrCreateRoot(
  orgId: string,
  name: string,
  counts: Counts,
): Promise<string> {
  const existing = await prisma.sOPFolder.findFirst({
    where: { organizationId: orgId, parentId: null, name },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (dryRun) {
    counts.foldersCreated++;
    return `dry-run-root:${orgId}:${name}`;
  }
  const created = await prisma.sOPFolder.create({
    data: {
      organizationId: orgId,
      parentId: null,
      name,
      color: colorFor(name),
    },
    select: { id: true },
  });
  counts.foldersCreated++;
  return created.id;
}

async function findOrCreateChild(
  orgId: string,
  parentId: string,
  name: string,
  counts: Counts,
): Promise<string> {
  // For dry-run synthetic parent ids, just return a synthetic child id —
  // we won't write anything.
  if (parentId.startsWith("dry-run-")) {
    counts.childFoldersCreated++;
    return `${parentId}>${name}`;
  }
  const existing = await prisma.sOPFolder.findFirst({
    where: { organizationId: orgId, parentId, name },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (dryRun) {
    counts.childFoldersCreated++;
    return `dry-run-child:${parentId}:${name}`;
  }
  const created = await prisma.sOPFolder.create({
    data: {
      organizationId: orgId,
      parentId,
      name,
      color: colorFor(name),
    },
    select: { id: true },
  });
  counts.childFoldersCreated++;
  return created.id;
}

async function migrateOrg(orgId: string, counts: Counts): Promise<void> {
  const sops = await prisma.sOP.findMany({
    where: { organizationId: orgId },
    select: {
      id: true, title: true, category: true, subcategory: true, folderId: true,
    },
  });

  // Cache folder ids per (parent, name) so we don't hit the DB once per SOP.
  const rootCache = new Map<string, string>();
  const childCache = new Map<string, string>();

  for (const sop of sops) {
    counts.sopsScanned++;

    const category = sop.category?.trim();
    const subcategory = sop.subcategory?.trim();

    if (!category) {
      counts.skippedNoCategory++;
      continue;
    }

    if (sop.folderId) {
      counts.alreadyFoldered++;
      if (verbose) console.log(`  · ${sop.title} — already foldered, leaving`);
      continue;
    }

    let rootId = rootCache.get(category);
    if (!rootId) {
      rootId = await findOrCreateRoot(orgId, category, counts);
      rootCache.set(category, rootId);
    }

    let targetId = rootId;
    if (subcategory) {
      const key = `${rootId}>${subcategory}`;
      let childId = childCache.get(key);
      if (!childId) {
        childId = await findOrCreateChild(orgId, rootId, subcategory, counts);
        childCache.set(key, childId);
      }
      targetId = childId;
    }

    if (verbose) {
      const path = subcategory ? `${category} / ${subcategory}` : category;
      console.log(`  · ${sop.title} → ${path}`);
    }

    if (!dryRun && !targetId.startsWith("dry-run-")) {
      await prisma.sOP.update({
        where: { id: sop.id },
        data: { folderId: targetId },
      });
    }
    counts.sopsLinked++;
  }
}

async function main() {
  console.log(
    `=== SOP category → folder migration ===\n` +
    `mode: ${dryRun ? "DRY RUN (no writes)" : "LIVE"}\n` +
    `org:  ${orgFilter || "(all)"}\n`,
  );

  const orgWhere = orgFilter ? { id: orgFilter } : {};
  const orgs = await prisma.organization.findMany({
    where: orgWhere,
    select: { id: true, name: true },
  });

  const counts: Counts = {
    orgs: orgs.length,
    sopsScanned: 0,
    sopsLinked: 0,
    foldersCreated: 0,
    childFoldersCreated: 0,
    alreadyFoldered: 0,
    skippedNoCategory: 0,
  };

  for (const org of orgs) {
    console.log(`\n[org] ${org.name} (${org.id})`);
    await migrateOrg(org.id, counts);
  }

  console.log(
    `\n=== Summary ===\n` +
    `orgs scanned:           ${counts.orgs}\n` +
    `SOPs scanned:           ${counts.sopsScanned}\n` +
    `SOPs linked to folder:  ${counts.sopsLinked}\n` +
    `SOPs already foldered:  ${counts.alreadyFoldered}\n` +
    `SOPs without category:  ${counts.skippedNoCategory}\n` +
    `top-level folders made: ${counts.foldersCreated}\n` +
    `child folders made:     ${counts.childFoldersCreated}\n`,
  );

  if (dryRun) {
    console.log(`\nDRY RUN — nothing was written. Re-run without --dry-run to apply.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
