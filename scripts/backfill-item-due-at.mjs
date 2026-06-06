// One-shot backfill: copy each board's first DATE-typed metadata value
// into the new Item.dueAt column (Phase 58 schema), so the Calendar +
// Gantt views can drop the over-fetch metadata-projection fallback.
//
// Safe to re-run — only touches rows where dueAt is currently null and
// the metadata value parses as a Date. Logs a per-board summary.
//
// Usage: node scripts/backfill-item-due-at.mjs
//   --dry-run    Don't write; just print what would change
//   --board=ID   Limit to one board id
//
// Notes:
//   - Reads first field with fieldType === "DATE" in board.schema.fields
//   - Items without metadata or with unparseable values are skipped silently
//   - Items with dueAt already set are never overwritten

import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
loadEnv();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const dryRun = process.argv.includes("--dry-run");
const boardArg = process.argv.find((a) => a.startsWith("--board="));
const limitToBoard = boardArg ? boardArg.split("=")[1] : null;

function readDateFieldKey(schema) {
  if (!schema || typeof schema !== "object") return null;
  const fields = schema.fields;
  if (!Array.isArray(fields)) return null;
  const dateField = fields.find((f) => f && f.fieldType === "DATE");
  return dateField?.key ?? null;
}

async function main() {
  const boards = await prisma.board.findMany({
    where: limitToBoard ? { id: limitToBoard } : { archivedAt: null },
    select: { id: true, name: true, schema: true },
  });

  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const b of boards) {
    const key = readDateFieldKey(b.schema);
    if (!key) continue;

    const items = await prisma.item.findMany({
      where: { boardId: b.id, dueAt: null, archivedAt: null },
      select: { id: true, metadata: true },
    });

    let updatedThisBoard = 0;
    let skippedThisBoard = 0;
    for (const it of items) {
      totalProcessed += 1;
      const meta = it.metadata;
      const raw = meta && typeof meta === "object" ? meta[key] : null;
      if (typeof raw !== "string" && !(raw instanceof Date)) {
        skippedThisBoard += 1; continue;
      }
      const parsed = raw instanceof Date ? raw : new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        skippedThisBoard += 1; continue;
      }
      if (!dryRun) {
        await prisma.item.update({
          where: { id: it.id },
          data: { dueAt: parsed },
        });
      }
      updatedThisBoard += 1;
    }
    totalUpdated += updatedThisBoard;
    totalSkipped += skippedThisBoard;
    if (updatedThisBoard > 0 || skippedThisBoard > 0) {
      console.log(`[${b.name}] key="${key}" ${dryRun ? "would update" : "updated"} ${updatedThisBoard}, skipped ${skippedThisBoard}`);
    }
  }

  console.log("");
  console.log(`Done. processed=${totalProcessed} updated=${totalUpdated} skipped=${totalSkipped}${dryRun ? " (dry-run)" : ""}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
