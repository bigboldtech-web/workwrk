/**
 * access-retire-matrix.ts: the permission matrix's retirement
 * (access-model-spec section 9; Phase 8 stage E).
 *
 * For every workspace that stored a matrix (Organization.settings.permissions):
 *
 *   dry run (default)  prints each cell the workspace changed from the shipped
 *                      grid and the section 9 rule it becomes. Changes nothing.
 *   --write            writes ONE access.matrix_retired activity row per
 *                      workspace holding the matrix exactly as stored (the
 *                      Data > Export "previous permissions grid" download
 *                      reads it). A workspace that already has the row is
 *                      skipped. The stored matrix is NOT removed.
 *   --write --strip    also removes settings.permissions, in the same
 *                      transaction as the row, and only when the export row
 *                      exists and ACCESS_V2_RESOLVER=true in this process's
 *                      environment (the engine then answers the cells the
 *                      product enforces; every other cell falls back to the
 *                      shipped grid). This is step 8 territory: the founder
 *                      runs it after the resolver has run clean in production.
 *
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/access-retire-matrix.ts [--org <id>] [--out report.json] [--write [--strip]]
 */

import { writeFileSync } from "node:fs";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { customisedCells, hasStoredMatrix } from "../src/lib/access/matrix-retire";
import { accessV2Resolver } from "../src/lib/access/flags";

const prisma = scriptPrisma();
const args = process.argv.slice(2);
const argOf = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? null : null);
const ONLY_ORG = argOf("--org");
const OUT = argOf("--out");
const WRITE = args.includes("--write");
const STRIP = args.includes("--strip");

async function main() {
  console.log(`access-retire-matrix   database: ${databaseLabel()}   mode: ${WRITE ? (STRIP ? "WRITE + STRIP" : "WRITE") : "dry run"}`);
  if (STRIP && !WRITE) {
    console.error("--strip needs --write");
    process.exit(2);
  }
  if (STRIP && !accessV2Resolver()) {
    console.error("--strip refused: ACCESS_V2_RESOLVER is not true here, so the stored matrix still decides who may do what. Export only (drop --strip).");
    process.exit(2);
  }
  const orgs = await prisma.organization.findMany({
    where: ONLY_ORG ? { id: ONLY_ORG } : {},
    select: { id: true, name: true, settings: true },
    orderBy: { createdAt: "asc" },
  });
  const report: Record<string, unknown>[] = [];
  let withMatrix = 0;
  for (const o of orgs) {
    if (!hasStoredMatrix(o.settings)) continue;
    withMatrix++;
    const matrix = (o.settings as { permissions: unknown }).permissions;
    const cells = customisedCells(matrix as never);
    const existing = await prisma.activityLog.findFirst({ where: { organizationId: o.id, type: "access.matrix_retired" }, select: { id: true } });
    console.log(`\n${o.name} (${o.id}): ${cells.length} cells changed from the shipped grid${existing ? "; already exported" : ""}`);
    for (const c of cells) console.log(`  ${c.level} ${c.module}.${c.action}: stored ${c.stored ? "yes" : "no"}, shipped ${c.shipped ? "yes" : "no"}${c.becomes ? `  -> ${c.becomes}` : "  -> the shipped grid"}`);
    const entry: Record<string, unknown> = { organizationId: o.id, name: o.name, cells, exported: !!existing };
    if (WRITE) {
      await prisma.$transaction(async (tx) => {
        let rowId = existing?.id ?? null;
        if (!rowId) {
          const actor = await tx.user.findFirst({
            where: { organizationId: o.id, deletedAt: null, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
          const row = await tx.activityLog.create({
            data: {
              organizationId: o.id,
              actorId: actor?.id ?? null,
              actorType: "system",
              actorLabel: "Access migration",
              type: "access.matrix_retired",
              targetType: "Organization",
              targetId: o.id,
              description: `The permissions grid was exported before it retires (${cells.length} cells differed from the shipped grid).`,
              oldValue: JSON.parse(JSON.stringify(matrix)),
              metadata: { note: "The grid as this workspace stored it. The access switches on Settings > Access and the fixed rules replace it.", cells: JSON.parse(JSON.stringify(cells)) },
            },
            select: { id: true },
          });
          rowId = row.id;
        }
        if (STRIP) {
          await tx.$executeRaw`UPDATE "Organization" SET settings = settings - 'permissions' WHERE id = ${o.id}`;
        }
        entry.exported = true;
        entry.rowId = rowId;
        entry.stripped = STRIP;
      });
      console.log(`  WRITTEN: access.matrix_retired ${entry.rowId}${STRIP ? "; settings.permissions removed" : "; settings.permissions kept"}`);
    }
    report.push(entry);
  }
  console.log(`\nworkspaces: ${orgs.length}   with a stored grid: ${withMatrix}`);
  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), database: databaseLabel(), mode: WRITE ? (STRIP ? "write+strip" : "write") : "dry-run", report }, null, 2));
    console.log(`report written to ${OUT}`);
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
