/**
 * migrate-public-sop-links.ts: carry every existing public SOP link over
 * access toggle 10 ("Public links").
 *
 * Spec: docs/plans/ui-refresh/spec-process.md section 4, step 8 ("it ships in
 * the same PR as the public-SOP change, never after it") and section 0's
 * disposition row for links minted before this release.
 * Rules: scripts/MIGRATIONS.md (all seven).
 *
 * WHY. `SOP.shareToken` was minted with no org toggle at all, and toggle 10's
 * default is Off. `/share/sop/[token]` now answers only while the org's
 * `settings.access.publicLinks` is "view" (and refuses to mint a new token
 * while it is Off). Without this step every public SOP link in every org
 * would read "This link is no longer available" on release day, which the
 * "every destination that works today keeps working" rule forbids.
 *
 * WHAT IT DOES. For every organization holding at least one PUBLISHED SOP
 * with a non-null `shareToken`, set `settings.access.publicLinks = "view"`,
 * leaving every other key of `settings` and of `settings.access` untouched,
 * and write one `access.settings.migrated` ActivityLog row naming the count,
 * so an admin who later turns the toggle off can see why it was on. Orgs with
 * no public SOP stay on the Off default. Orgs already on "view" are reported
 * as "already migrated" and not written.
 *
 * Idempotent (the marker read back is the value itself), one transaction per
 * org, a read-back assertion after the write, no source row is deleted or
 * changed (SOP rows are only counted).
 *
 * Usage:
 *   npx tsx scripts/migrate-public-sop-links.ts                       # dry run
 *   npx tsx scripts/migrate-public-sop-links.ts --report /tmp/r.txt   # dry run, saved
 *   npx tsx scripts/migrate-public-sop-links.ts --org <id>            # one org
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/migrate-public-sop-links.ts --write             # LOCAL only
 */

import fs from "node:fs";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";

const prisma = scriptPrisma();

interface OrgReport {
  organizationId: string;
  organizationName: string;
  publicSops: number;
  before: string;
  action: "flip" | "already" | "none";
  error?: string;
}

interface Report {
  ranAt: string;
  database: string;
  write: boolean;
  orgFilter: string | null;
  orgs: OrgReport[];
  totals: { orgsRead: number; orgsWithPublicSops: number; orgsFlipped: number; orgsAlready: number; publicSops: number };
}

function readPublicLinks(settings: unknown): string {
  const access = (settings as { access?: { publicLinks?: unknown } } | null)?.access;
  return typeof access?.publicLinks === "string" ? access.publicLinks : "off";
}

async function migrateOrg(org: { id: string; name: string; settings: unknown }, write: boolean): Promise<OrgReport> {
  const publicSops = await prisma.sOP.count({ where: { organizationId: org.id, status: "PUBLISHED", shareToken: { not: null } } });
  const before = readPublicLinks(org.settings);
  const r: OrgReport = { organizationId: org.id, organizationName: org.name, publicSops, before, action: "none" };
  if (publicSops === 0) return r;
  if (before === "view") { r.action = "already"; return r; }
  r.action = "flip";
  if (!write) return r;

  const users = await prisma.user.findMany({
    where: { organizationId: org.id, deletedAt: null },
    select: { id: true, accessLevel: true },
    orderBy: { createdAt: "asc" },
  });
  const actorId =
    users.find((u) => u.accessLevel === "SUPER_ADMIN")?.id ??
    users.find((u) => u.accessLevel === "COMPANY_ADMIN")?.id ??
    users[0]?.id ??
    null;

  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.organization.findUnique({ where: { id: org.id }, select: { settings: true } });
      const settings = { ...((fresh?.settings ?? {}) as Record<string, unknown>) };
      const access = { ...((settings.access ?? {}) as Record<string, unknown>), publicLinks: "view" };
      settings.access = access;
      await tx.organization.update({ where: { id: org.id }, data: { settings: settings as object } });

      const after = await tx.organization.findUnique({ where: { id: org.id }, select: { settings: true } });
      if (readPublicLinks(after?.settings) !== "view") {
        throw new Error(`Assertion failed for ${org.name}: settings.access.publicLinks is not "view" after the write. Rolled back.`);
      }
      if (actorId) {
        await tx.activityLog.create({
          data: {
            organizationId: org.id,
            actorId,
            type: "access.settings.migrated",
            targetType: "organization",
            targetId: org.id,
            description: `Public links set to "View only" because this workspace already holds ${publicSops} public SOP link(s). Turning it off in Settings > Access will stop those links.`,
            metadata: { key: "publicLinks", from: before, to: "view", publicSops },
          },
        });
      }
    });
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
  }
  return r;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const orgFilter = args.includes("--org") ? args[args.indexOf("--org") + 1] ?? null : null;
  const reportPath = args.includes("--report") ? args[args.indexOf("--report") + 1] ?? null : null;

  const orgs = await prisma.organization.findMany({
    where: orgFilter ? { id: orgFilter } : undefined,
    select: { id: true, name: true, settings: true },
    orderBy: { createdAt: "asc" },
  });

  const report: Report = {
    ranAt: new Date().toISOString(),
    database: databaseLabel(),
    write,
    orgFilter,
    orgs: [],
    totals: { orgsRead: orgs.length, orgsWithPublicSops: 0, orgsFlipped: 0, orgsAlready: 0, publicSops: 0 },
  };

  for (const org of orgs) {
    const r = await migrateOrg(org, write);
    report.orgs.push(r);
    if (r.publicSops > 0) report.totals.orgsWithPublicSops += 1;
    report.totals.publicSops += r.publicSops;
    if (r.action === "already") report.totals.orgsAlready += 1;
    if (r.action === "flip" && write && !r.error) report.totals.orgsFlipped += 1;
  }

  const lines: string[] = [];
  lines.push(`migrate-public-sop-links ${write ? "WRITE" : "DRY RUN"} at ${report.ranAt} against ${report.database}`);
  lines.push(`orgs read ${report.totals.orgsRead}, with public SOPs ${report.totals.orgsWithPublicSops}, already on view ${report.totals.orgsAlready}, ${write ? "flipped" : "would flip"} ${write ? report.totals.orgsFlipped : report.orgs.filter((o) => o.action === "flip").length}, public SOP links ${report.totals.publicSops}`);
  for (const o of report.orgs) {
    if (o.publicSops === 0) continue;
    lines.push(`  ${o.organizationName} (${o.organizationId}): ${o.publicSops} public SOP(s), publicLinks was "${o.before}", ${o.action === "already" ? "already migrated" : write ? (o.error ? `FAILED: ${o.error}` : "flipped to view") : "would flip to view"}`);
  }
  const text = lines.join("\n");
  console.log(text);
  if (reportPath) {
    fs.writeFileSync(reportPath, `${text}\n\n${JSON.stringify(report, null, 2)}\n`);
    console.log(`report saved to ${reportPath}`);
  }
  await prisma.$disconnect();
  if (report.orgs.some((o) => o.error)) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
