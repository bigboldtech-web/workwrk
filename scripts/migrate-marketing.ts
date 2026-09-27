/**
 * migrate-marketing.ts: move every legacy Campaign, ContentItem and EventBrief
 * onto tasks in a "Marketing" Space built from the seeded Space template.
 *
 * Spec: docs/plans/ui-refresh/spec-tools-misc.md section 2.7 (and 4, step 5).
 * Rules: scripts/MIGRATIONS.md (all seven).
 *
 * The work is in src/lib/marketing/legacy-import.ts, which the Settings >
 * Data > Import row also calls, so the report the founder reads here is the
 * same report an Owner reads on the page. This file only walks the orgs,
 * prints, saves and gates on --write.
 *
 * WHY. The five /marketing pages were orphaned (no nav entry, session-only
 * gates, nothing could set a budget or a date) and Marketing left the
 * product scope on 2026-06-03. The rows they held are real work, so they
 * become tasks on Lists, where every field is editable by construction. The
 * order matters: the /marketing resolver 308s to the Space only once this
 * has run; before that an Owner or Admin is sent to the import row and
 * everyone else sees the in-shell 404.
 *
 * WHAT IS COPIED, per row: title, status (mapped onto the List's own set),
 * the dates onto the built-in Start and Due date columns, the owner when
 * they are still a live member, and every other column onto the List's
 * seeded field with the same name (channel, budget, spent, goal metric and
 * targets, type, links, format, capacity, registered, attended, location).
 * A column with no field is folded into the description and reported as an
 * unmapped field. The row's id and original status sit under
 * `Item.metadata.legacyMarketing`; the task's id is written back as
 * `customFields.migratedItemId` on the row, so the link holds both ways.
 * Nothing is deleted.
 *
 * What a Member keeps and loses: yesterday any signed-in employee could add
 * and edit campaigns, content and events on the old pages. After the run
 * every Member can VIEW the Marketing Space (it is created org-visible);
 * editing needs Space membership, which an Owner grants from the Space's
 * share dialog. The page's confirm, its success toast and the report all say
 * so, so nobody discovers it on a locked List.
 *
 * Usage:
 *
 *   npx tsx scripts/migrate-marketing.ts                        # dry run, every org
 *   npx tsx scripts/migrate-marketing.ts --org <id>             # one org
 *   npx tsx scripts/migrate-marketing.ts --report /tmp/r.json   # dry run, saved
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/migrate-marketing.ts --write              # LOCAL only
 *
 * The lib imports the app's own Prisma client (src/lib/prisma.ts), which reads
 * DATABASE_URL exactly as scripts/lib/script-prisma.ts does, so the command
 * line names the database the same way as every other script here.
 */

import fs from "node:fs";
import { prisma } from "../src/lib/prisma";
import { databaseLabel } from "./lib/script-prisma";
import { emptyKind, importLegacyMarketing, type LegacyMarketingReport } from "../src/lib/marketing/legacy-import";
import { MARKETING_KINDS } from "../src/lib/marketing/legacy-map";

interface Report {
  ranAt: string;
  database: string;
  write: boolean;
  orgFilter: string | null;
  orgs: LegacyMarketingReport[];
  totals: { read: number; alreadyMigrated: number; written: number; blocked: number; errors: number };
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const write = process.argv.includes("--write");
  const reportAt = argValue("--report");
  const orgFilter = argValue("--org");

  const report: Report = {
    ranAt: new Date().toISOString(),
    database: databaseLabel(),
    write,
    orgFilter,
    orgs: [],
    totals: { read: 0, alreadyMigrated: 0, written: 0, blocked: 0, errors: 0 },
  };

  const orgs = await prisma.organization.findMany({
    where: orgFilter ? { id: orgFilter } : {},
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  for (const org of orgs) {
    // Only orgs holding legacy rows get a report line: the rest have nothing to move.
    const [c, ci, e] = await Promise.all([
      prisma.campaign.count({ where: { organizationId: org.id } }),
      prisma.contentItem.count({ where: { organizationId: org.id } }),
      prisma.eventBrief.count({ where: { organizationId: org.id } }),
    ]);
    if (c + ci + e === 0) continue;

    // The Space's owner and every task's actor: the org's first Owner, else
    // its first Admin. An org with neither is reported and skipped.
    const actor =
      (await prisma.user.findFirst({ where: { organizationId: org.id, deletedAt: null, accessLevel: "SUPER_ADMIN" }, select: { id: true }, orderBy: { createdAt: "asc" } })) ??
      (await prisma.user.findFirst({ where: { organizationId: org.id, deletedAt: null, accessLevel: "COMPANY_ADMIN" }, select: { id: true }, orderBy: { createdAt: "asc" } }));
    let r: LegacyMarketingReport;
    if (!actor) {
      const name = (await prisma.organization.findUnique({ where: { id: org.id }, select: { name: true } }))?.name ?? org.id;
      r = {
        organizationId: org.id,
        organizationName: name,
        write,
        currency: "",
        templateFound: false,
        spaceSlug: null,
        spaceCreated: false,
        kinds: {
          campaigns: { ...emptyKind(), read: c },
          content: { ...emptyKind(), read: ci },
          events: { ...emptyKind(), read: e },
        },
        blocked: "This workspace has no live Owner or Admin to own the Marketing Space.",
        blockedDetail: "no live Owner or Admin to own the Marketing Space",
        blockedCode: "actor",
      };
    } else {
      r = await importLegacyMarketing({ organizationId: org.id, actorId: actor.id, write });
    }
    report.orgs.push(r);
    for (const k of MARKETING_KINDS) {
      report.totals.read += r.kinds[k].read;
      report.totals.alreadyMigrated += r.kinds[k].alreadyMigrated;
      report.totals.written += r.kinds[k].written;
    }
    if (r.blocked) report.totals.blocked += 1;
    if (r.error) report.totals.errors += 1;
  }

  const text = render(report);
  console.log(text);
  if (reportAt) {
    fs.mkdirSync(reportAt.replace(/\/[^/]+$/, ""), { recursive: true });
    fs.writeFileSync(reportAt, reportAt.endsWith(".json") ? JSON.stringify(report, null, 2) : text);
    console.log(`\nReport saved to ${reportAt}`);
  }
  if (!write) console.log("\nDRY RUN. Nothing was written. Add --write to apply (see scripts/MIGRATIONS.md).");
  if (report.totals.errors > 0) process.exitCode = 1;
}

function render(report: Report): string {
  const out: string[] = [];
  out.push(`migrate-marketing: ${report.write ? "WRITE" : "DRY RUN"}  ${report.ranAt}`);
  out.push(`database: ${report.database}${report.orgFilter ? `   org filter: ${report.orgFilter}` : ""}`);
  out.push("");
  if (report.orgs.length === 0) out.push("No organization holds legacy Marketing rows. Nothing to move.");
  for (const o of report.orgs) {
    out.push(`${o.organizationName} (${o.organizationId})   currency ${o.currency || "?"}`);
    if (o.blocked) {
      out.push(`  BLOCKED: ${o.blockedDetail ?? o.blocked}`);
      if (o.blockedDetail) out.push(`           (shown on the page as: ${o.blocked})`);
      if (o.archived) out.push(`  space      ${o.spaceSlug ?? "?"}  IN TRASH`);
      out.push("");
      continue;
    }
    out.push(`  space      ${o.spaceSlug ?? "(new)"}${o.spaceCreated ? "  will be created" : ""}`);
    for (const k of MARKETING_KINDS) {
      const r = o.kinds[k];
      out.push(`  ${k.padEnd(10)} read ${r.read}, already moved ${r.alreadyMigrated}, ${report.write ? "written" : "to write"} ${r.written}` +
        (r.relinked ? `, re-linked ${r.relinked}` : "") +
        `, status moved ${r.statusMoved}, owner dropped ${r.ownerDropped}` +
        (k === "campaigns" ? `, currency differs ${r.currencyMismatch}` : "") +
        `   list ${r.listSlug ?? "(new)"}`);
      for (const u of r.unmappedStatuses) out.push(`             unmapped status ${u.value}: ${u.count} row(s), lands on the first status`);
      for (const f of r.unmappedFields) out.push(`             folded into description: ${f.field} (${f.count} row(s))`);
    }
    if (o.error) out.push(`  ERROR: ${o.error}  (rows already marked are done; run again to resume)`);
    if (o.verified) out.push("  verified: every row points at a task that exists");
    if (report.write && o.verified) out.push("  the Space is visible to everyone; Members edit once an Owner adds them to it");
    out.push("");
  }
  out.push(`totals: read ${report.totals.read}, already moved ${report.totals.alreadyMigrated}, ${report.write ? "written" : "to write"} ${report.totals.written}, blocked orgs ${report.totals.blocked}, errors ${report.totals.errors}`);
  return out.join("\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
