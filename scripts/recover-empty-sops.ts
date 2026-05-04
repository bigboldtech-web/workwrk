/**
 * One-shot recovery for the four SOPs that ended up empty in prod
 * (see scripts/audit-empty-sops.ts to find them).
 *
 * Three independent fixes:
 *
 *   1. Row 2 — `Referral Transactions & Payouts — Daily Approval`
 *      Live row had its title + content blanked when v2 was
 *      published. v1 in SOPVersion still has the original. Restore.
 *
 *   2. Row 4 — `Marketing Generalist Daily Rhythm` (archived)
 *      Body lives in `description`, not `content.html`. Copy across
 *      so the editor view actually shows it.
 *
 *   3. Row 3 — empty draft in Marketing / Community Management
 *      No data to recover, never had any. Delete it.
 *
 * Row 1 (Lead Reallocation Rules) is a legitimate unfinished draft —
 * left alone.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/recover-empty-sops.ts --dry-run
 *   DATABASE_URL=... npx tsx scripts/recover-empty-sops.ts
 *
 * Idempotent: re-running after success is a no-op.
 */
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "../src/generated/prisma";
import { PrismaNeon } from "@prisma/adapter-neon";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaNeon({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

const dryRun = process.argv.includes("--dry-run");

const TARGETS = {
  REFERRAL_PAYOUTS_BLANKED: "cmocmedq6000svas6cjv6yz6k",
  MARKETING_DAILY_RHYTHM: "cmo9ptobu000ieis6nq0ep85w",
  EMPTY_COMMUNITY_DRAFT: "cmobf9f5h000dvas6af2ql6ci",
};

async function restoreFromV1(id: string) {
  const sop = await prisma.sOP.findUnique({
    where: { id },
    select: { id: true, title: true, content: true, version: true },
  });
  if (!sop) return console.log(`  ! ${id} not found`);

  const v1 = await prisma.sOPVersion.findFirst({
    where: { sopId: id },
    orderBy: { version: "asc" },
    select: { version: true, title: true, content: true, description: true },
  });
  if (!v1) return console.log(`  ! ${id} has no version snapshots — can't restore`);

  console.log(`  · current title="${sop.title}", v=${sop.version}`);
  console.log(`  · v1 title="${v1.title}" (snapshot v${v1.version})`);
  console.log(`  → would restore title + content from v1 snapshot, set version back to v1`);

  if (dryRun) return;

  await prisma.sOP.update({
    where: { id },
    data: {
      title: v1.title || sop.title,
      content: (v1.content as object) ?? sop.content as object,
      description: v1.description ?? undefined,
      version: 1,
    },
  });
  console.log(`  ✓ restored`);
}

async function backfillHtmlFromDescription(id: string) {
  const sop = await prisma.sOP.findUnique({
    where: { id },
    select: { id: true, title: true, description: true, content: true },
  });
  if (!sop) return console.log(`  ! ${id} not found`);

  const c = (sop.content ?? {}) as { type?: string; html?: string };
  const hasUsableHtml = !!c.html && c.html.trim() !== "" && c.html.trim() !== "<p></p>";
  if (hasUsableHtml) {
    console.log(`  · "${sop.title}" already has html — nothing to do`);
    return;
  }
  if (!sop.description || sop.description.trim() === "") {
    console.log(`  · "${sop.title}" has no description either — skipping`);
    return;
  }

  // Convert plain-text description to a minimal richtext html.
  // Each paragraph becomes a <p>, double newlines = paragraph break.
  const html = sop.description
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");

  console.log(`  · "${sop.title}" — would backfill ${html.length} chars of html from description`);

  if (dryRun) return;

  await prisma.sOP.update({
    where: { id },
    data: {
      content: { type: "richtext", html },
    },
  });
  console.log(`  ✓ backfilled`);
}

async function deleteEmptyDraft(id: string) {
  const sop = await prisma.sOP.findUnique({
    where: { id },
    select: { id: true, title: true, status: true, content: true, _count: { select: { compliance: true, assignments: true } } },
  });
  if (!sop) return console.log(`  ! ${id} not found`);

  if (sop.status !== "DRAFT") {
    console.log(`  ! ${id} is not DRAFT (status=${sop.status}) — refusing to delete`);
    return;
  }
  if (sop.title && sop.title.trim() !== "") {
    console.log(`  ! ${id} has title "${sop.title}" — refusing to delete`);
    return;
  }
  if ((sop._count.compliance ?? 0) > 0 || (sop._count.assignments ?? 0) > 0) {
    console.log(`  ! ${id} has compliance/assignments — refusing to delete`);
    return;
  }

  console.log(`  · empty DRAFT, no compliance, no assignments → would delete`);

  if (dryRun) return;

  await prisma.sOP.delete({ where: { id } });
  console.log(`  ✓ deleted`);
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function main() {
  console.log(`mode: ${dryRun ? "DRY RUN" : "LIVE"}\n`);

  console.log(`[1] Restore Referral Payouts SOP from v1 snapshot:`);
  await restoreFromV1(TARGETS.REFERRAL_PAYOUTS_BLANKED);

  console.log(`\n[2] Backfill html from description on Marketing Generalist Daily Rhythm:`);
  await backfillHtmlFromDescription(TARGETS.MARKETING_DAILY_RHYTHM);

  console.log(`\n[3] Delete empty Marketing/Community Management draft:`);
  await deleteEmptyDraft(TARGETS.EMPTY_COMMUNITY_DRAFT);

  if (dryRun) console.log(`\nDRY RUN — nothing was written. Re-run without --dry-run to apply.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
