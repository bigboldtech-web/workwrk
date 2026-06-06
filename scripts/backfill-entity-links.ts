/**
 * One-time EntityLink backfill for existing docs + SOPs.
 *
 * Run after deploying the doc-link sync code. Walks every doc and
 * SOP in every organization, extracts outgoing references from their
 * block content (sop_card, task_card, note_card, subpage, entity_link,
 * inline @-mention pills), and upserts the corresponding EntityLink
 * rows so backlinks and the mentions inbox return real data without
 * waiting for someone to edit each old doc/SOP.
 *
 * Idempotent. Safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/backfill-entity-links.ts
 *
 * Flags:
 *   --dry-run       Report what would be synced without writing.
 *   --org=<id>      Limit to one organization (pilot before full run).
 *   --kind=doc|sop  Limit to docs or SOPs only.
 */

import { PrismaClient } from "../src/generated/prisma";
import { syncLinksFromBlocks } from "../src/lib/doc-link-extract";

const prisma = new PrismaClient();

interface Args {
  dryRun: boolean;
  org?: string;
  kind?: "doc" | "sop";
}

function parseArgs(): Args {
  const out: Args = { dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg.startsWith("--org=")) out.org = arg.slice("--org=".length);
    else if (arg.startsWith("--kind=")) {
      const k = arg.slice("--kind=".length);
      if (k === "doc" || k === "sop") out.kind = k;
      else { console.error(`invalid --kind=${k}`); process.exit(1); }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs();
  console.log(`[backfill-entity-links] starting${args.dryRun ? " (dry run)" : ""}`);

  if (!args.kind || args.kind === "doc") await backfillDocs(args);
  if (!args.kind || args.kind === "sop") await backfillSops(args);

  console.log(`[backfill-entity-links] done`);
}

async function backfillDocs(args: Args) {
  const where = {
    ...(args.org ? { organizationId: args.org } : {}),
    archivedAt: null,
  };
  const total = await prisma.doc.count({ where });
  console.log(`[docs] scanning ${total} docs…`);

  let processed = 0;
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  const pageSize = 200;
  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.doc.findMany({
      where,
      take: pageSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, organizationId: true, content: true, createdById: true },
    });
    if (batch.length === 0) break;

    for (const d of batch) {
      processed++;
      const blocks = (d.content as { blocks?: unknown[] } | null)?.blocks;
      if (!Array.isArray(blocks) || blocks.length === 0) { skipped++; continue; }
      if (args.dryRun) { synced++; continue; }
      try {
        await syncLinksFromBlocks({
          organizationId: d.organizationId,
          sourceType: "DOC",
          sourceId: d.id,
          content: d.content,
          createdById: d.createdById ?? null,
        });
        synced++;
      } catch (err) {
        failed++;
        console.warn(`[docs] sync failed for ${d.id}:`, err);
      }
    }

    cursor = batch[batch.length - 1].id;
    if (processed % 500 === 0) {
      console.log(`[docs] processed ${processed}/${total} (synced=${synced}, skipped=${skipped}, failed=${failed})`);
    }
  }
  console.log(`[docs] done: processed=${processed}, synced=${synced}, skipped=${skipped}, failed=${failed}`);
}

async function backfillSops(args: Args) {
  const where = {
    ...(args.org ? { organizationId: args.org } : {}),
    status: { not: "ARCHIVED" as const },
  };
  const total = await prisma.sOP.count({ where });
  console.log(`[sops] scanning ${total} SOPs…`);

  let processed = 0;
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  const pageSize = 200;
  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.sOP.findMany({
      where,
      take: pageSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, organizationId: true, content: true },
    });
    if (batch.length === 0) break;

    for (const s of batch) {
      processed++;
      // Only blocks-format SOPs have references we extract; legacy
      // checklist / recorded / richtext shapes get skipped.
      const c = s.content as { type?: string; blocks?: unknown[] } | null;
      if (!c || c.type !== "blocks" || !Array.isArray(c.blocks) || c.blocks.length === 0) {
        skipped++;
        continue;
      }
      if (args.dryRun) { synced++; continue; }
      try {
        await syncLinksFromBlocks({
          organizationId: s.organizationId,
          sourceType: "SOP",
          sourceId: s.id,
          content: s.content,
          createdById: null,
        });
        synced++;
      } catch (err) {
        failed++;
        console.warn(`[sops] sync failed for ${s.id}:`, err);
      }
    }

    cursor = batch[batch.length - 1].id;
    if (processed % 500 === 0) {
      console.log(`[sops] processed ${processed}/${total} (synced=${synced}, skipped=${skipped}, failed=${failed})`);
    }
  }
  console.log(`[sops] done: processed=${processed}, synced=${synced}, skipped=${skipped}, failed=${failed}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("[backfill-entity-links] fatal:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
