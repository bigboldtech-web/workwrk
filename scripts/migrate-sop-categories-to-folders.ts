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
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaPg({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

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

  // Map folder ids → name so we can decide whether a manually-placed
  // SOP is in the "right" top-level folder for its category.
  const folderRows = await prisma.sOPFolder.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, parentId: true },
  });
  const folderById = new Map(folderRows.map((f) => [f.id, f]));

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

    // Resolve where this SOP *should* live based on (category, subcategory).
    let rootId = rootCache.get(category);
    if (!rootId) {
      // If a folder with this exact name already exists at the top level,
      // re-use it. Otherwise create one.
      const existingRoot = folderRows.find((f) => f.parentId === null && f.name === category);
      rootId = existingRoot
        ? existingRoot.id
        : await findOrCreateRoot(orgId, category, counts);
      rootCache.set(category, rootId);
    }

    let targetId = rootId;
    if (subcategory) {
      const key = `${rootId}>${subcategory}`;
      let childId = childCache.get(key);
      if (!childId) {
        const existingChild = folderRows.find(
          (f) => f.parentId === rootId && f.name === subcategory,
        );
        childId = existingChild
          ? existingChild.id
          : await findOrCreateChild(orgId, rootId, subcategory, counts);
        childCache.set(key, childId);
      }
      targetId = childId;
    }

    // Decide whether to move this SOP.
    let shouldUpdate = false;
    let reason = "";

    if (!sop.folderId) {
      // Currently unfoldered — move into the resolved target.
      shouldUpdate = true;
      reason = "unfoldered → linking";
    } else if (sop.folderId === targetId) {
      // Already exactly where it should be.
      counts.alreadyFoldered++;
      if (verbose) console.log(`  · ${sop.title} — already at ${category}${subcategory ? ` / ${subcategory}` : ""}, leaving`);
      continue;
    } else {
      // It's somewhere else. Only move it if the manual placement is
      // along the same chain — i.e. it sits in the top-level folder
      // for its category but missing the subcategory layer. Anything
      // else looks like a deliberate manual override; leave it.
      const currentFolder = folderById.get(sop.folderId);
      if (currentFolder && currentFolder.name === category && currentFolder.parentId === null && subcategory) {
        // SOP is in the right root, just needs to drop into the subcategory.
        shouldUpdate = true;
        reason = "deepening into subcategory";
      } else {
        counts.alreadyFoldered++;
        if (verbose) console.log(`  · ${sop.title} — manually placed elsewhere (folder=${currentFolder?.name ?? sop.folderId}), leaving`);
        continue;
      }
    }

    if (verbose) {
      const path = subcategory ? `${category} / ${subcategory}` : category;
      console.log(`  · ${sop.title} → ${path}  [${reason}]`);
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
