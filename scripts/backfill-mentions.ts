/**
 * backfill-mentions.ts — turn the @-mentions already sitting in Docs and SOPs
 * into `mention` notifications, so the Inbox's Mentions tab reads ONE source.
 *
 * Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/inbox) and section
 * 4, data migration 2: "a one-time backfill turns today's `/api/me/mentions`
 * rows into notifications … `read = true` for links older than 30 days so
 * nobody wakes up to 400 unread rows".
 *
 * WHY IT HAS TO RUN BEFORE THE REDIRECT. `/me/mentions` is an orphan page over
 * the EntityLink graph: a `mention` notification and a `/me/mentions` row have
 * been two independent data paths for the same event, and the notification path
 * was only ever written for task comments and Talk. Redirect `/me/mentions` to
 * `/inbox?tab=mentions` without running this and every doc mention a person has
 * ever received becomes unreachable. That is why `/api/me/mentions` is NOT
 * deleted in the same release: the page's 308 is safe because the data has a
 * destination, and the route is retired separately, after the production run.
 *
 * IDEMPOTENT, keyed on the link. A mention's notification is identified by
 * `(userId, type = "mention", link = "/docs/<id>#b-<blockId>")`, which is
 * exactly one row per mention per person. Re-running finds them and writes
 * nothing. Editing the doc and re-mentioning the same person in the same block
 * is the same mention, and stays one row.
 *
 * NEVER DELETES. The EntityLink rows it reads are left exactly as they are.
 *
 * Usage — see scripts/MIGRATIONS.md for the approval gate.
 *
 *   npx tsx scripts/backfill-mentions.ts --report /tmp/mentions.json   # dry run
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/backfill-mentions.ts --write                     # LOCAL only
 *
 * Flags:
 *   --write            apply (default is a dry run)
 *   --report <path>    save the JSON report
 *   --org <id>         one organization only (pilot before the full run)
 *   --unread-days <n>  anything older than this is written read (default 30)
 */

import fs from "node:fs";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { findMentionBlocks, mentionLink } from "../src/lib/doc-mentions";

const prisma = scriptPrisma();

interface OrgReport {
  organizationId: string;
  organizationName: string;
  linksRead: number;
  mentionsFound: number;
  alreadyPresent: number;
  written: number;
  writtenUnread: number;
  /** Links whose source could not be resolved: named, never silently dropped. */
  unresolved: Array<{ sourceType: string; sourceId: string; reason: string }>;
}

interface Report {
  ranAt: string;
  database: string;
  write: boolean;
  unreadDays: number;
  orgs: OrgReport[];
  totals: { linksRead: number; mentionsFound: number; alreadyPresent: number; written: number };
}

async function main() {
  const write = process.argv.includes("--write");
  const reportAt = argValue("--report");
  const onlyOrg = argValue("--org");
  const unreadDays = parseInt(argValue("--unread-days") ?? "30", 10) || 30;
  const unreadCutoff = new Date(Date.now() - unreadDays * 86_400_000);

  const orgs = await prisma.organization.findMany({
    where: onlyOrg ? { id: onlyOrg } : {},
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  const report: Report = {
    ranAt: new Date().toISOString(),
    database: databaseLabel(),
    write,
    unreadDays,
    orgs: [],
    totals: { linksRead: 0, mentionsFound: 0, alreadyPresent: 0, written: 0 },
  };

  for (const org of orgs) {
    const r = await doOrg(org.id, org.name, write, unreadCutoff);
    report.orgs.push(r);
    report.totals.linksRead += r.linksRead;
    report.totals.mentionsFound += r.mentionsFound;
    report.totals.alreadyPresent += r.alreadyPresent;
    report.totals.written += r.written;
  }

  print(report);
  if (reportAt) {
    fs.writeFileSync(reportAt, JSON.stringify(report, null, 2));
    console.log(`\nReport saved to ${reportAt}`);
  }
  if (!write) console.log("\nDRY RUN. Nothing was written. Add --write to apply (see scripts/MIGRATIONS.md).");
}

async function doOrg(organizationId: string, organizationName: string, write: boolean, unreadCutoff: Date): Promise<OrgReport> {
  // Stand-in actor for the ActivityLog record of this run.
  const admin = await prisma.user.findFirst({
    where: { organizationId, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const actorId = admin?.id ?? null;
  const out: OrgReport = {
    organizationId, organizationName,
    linksRead: 0, mentionsFound: 0, alreadyPresent: 0, written: 0, writtenUnread: 0,
    unresolved: [],
  };

  // The same query /api/me/mentions runs, without the per-viewer narrowing:
  // every REFERENCES link from a DOC or SOP to a USER.
  const links = await prisma.entityLink.findMany({
    where: {
      organizationId,
      relationKind: "REFERENCES",
      targetType: "USER",
      sourceType: { in: ["DOC", "SOP"] },
    },
    select: { sourceType: true, sourceId: true, targetId: true, updatedAt: true },
  });
  out.linksRead = links.length;
  if (links.length === 0) return out;

  const docIds = [...new Set(links.filter((l) => l.sourceType === "DOC").map((l) => l.sourceId))];
  const sopIds = [...new Set(links.filter((l) => l.sourceType === "SOP").map((l) => l.sourceId))];
  const [docs, sops, members] = await Promise.all([
    docIds.length
      ? prisma.doc.findMany({
          where: { id: { in: docIds }, organizationId, archivedAt: null },
          select: { id: true, title: true, content: true, updatedAt: true },
        })
      : Promise.resolve([]),
    sopIds.length
      ? prisma.sOP.findMany({
          where: { id: { in: sopIds }, organizationId, status: { not: "ARCHIVED" } },
          select: { id: true, title: true, content: true, updatedAt: true },
        })
      : Promise.resolve([]),
    // A mention of somebody who has since left the org gets no notification:
    // Notification has no organizationId, so a row written for a user outside
    // this org would be unscoped and unreachable.
    prisma.user.findMany({ where: { organizationId }, select: { id: true } }),
  ]);
  const liveUsers = new Set(members.map((m) => m.id));
  const docById = new Map(docs.map((d) => [d.id, d]));
  const sopById = new Map(sops.map((s) => [s.id, s]));

  interface Planned { userId: string; title: string; message: string; link: string; createdAt: Date; read: boolean }
  const planned: Planned[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    const isDoc = link.sourceType === "DOC";
    const source = isDoc ? docById.get(link.sourceId) : sopById.get(link.sourceId);
    if (!source) {
      out.unresolved.push({ sourceType: link.sourceType, sourceId: link.sourceId, reason: "source missing or archived" });
      continue;
    }
    if (!liveUsers.has(link.targetId)) {
      out.unresolved.push({ sourceType: link.sourceType, sourceId: link.sourceId, reason: `user ${link.targetId} is not in this org` });
      continue;
    }
    const hits = findMentionBlocks(source.content, link.targetId);
    if (hits.length === 0) {
      // The link outlived the pill: the block was edited and the mention
      // removed, but the EntityLink was not re-synced. Named, not written.
      out.unresolved.push({ sourceType: link.sourceType, sourceId: link.sourceId, reason: "no mention block found for this user" });
      continue;
    }
    for (const hit of hits) {
      const href = mentionLink(isDoc ? "doc" : "sop", source.id, hit.blockId);
      const key = `${link.targetId}|${href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.mentionsFound += 1;
      planned.push({
        userId: link.targetId,
        title: `You were mentioned in ${source.title || (isDoc ? "a note" : "an SOP")}`,
        message: hit.excerpt || "You were mentioned.",
        link: href,
        createdAt: source.updatedAt,
        // Older than the cutoff arrives already read, so nobody opens the new
        // Inbox to four hundred unread rows about things they read last year.
        read: source.updatedAt < unreadCutoff,
      });
    }
  }

  if (planned.length === 0) return out;

  // Which of these already exist. One query, keyed the same way the write is.
  const existing = await prisma.notification.findMany({
    where: {
      type: "mention",
      userId: { in: [...new Set(planned.map((p) => p.userId))] },
      link: { in: [...new Set(planned.map((p) => p.link))] },
    },
    select: { userId: true, link: true },
  });
  const have = new Set(existing.map((e) => `${e.userId}|${e.link}`));
  const toWrite = planned.filter((p) => !have.has(`${p.userId}|${p.link}`));
  out.alreadyPresent = planned.length - toWrite.length;

  if (!write) {
    out.written = 0;
    return out;
  }

  // One transaction per org (rule 4), with the row-count assertion inside it,
  // so a mismatch rolls this org back and leaves every other org alone.
  await prisma.$transaction(async (tx) => {
    const result = await tx.notification.createMany({
      data: toWrite.map((p) => ({
        userId: p.userId,
        type: "mention",
        title: p.title,
        message: p.message,
        link: p.link,
        read: p.read,
        createdAt: p.createdAt,
      })),
    });
    if (result.count !== toWrite.length) {
      throw new Error(
        `Assertion failed for org ${organizationId}: planned ${toWrite.length}, wrote ${result.count}. Rolled back.`,
      );
    }
    out.written = result.count;
    out.writtenUnread = toWrite.filter((p) => !p.read).length;

    // Rule 7: the report is archived in the product, not only in a file.
    // ActivityLog requires an actor, and a migration has no person behind it,
    // so the org's first admin stands in and the description says plainly that
    // it was a migration rather than something they did.
    if (actorId) await tx.activityLog.create({
      data: {
        organizationId,
        actorId,
        type: "work.mentions_backfilled",
        targetType: "notification",
        targetId: organizationId,
        description: `Mentions backfill: ${out.written} notification(s) written from ${out.linksRead} EntityLink row(s).`,
        metadata: {
          linksRead: out.linksRead,
          mentionsFound: out.mentionsFound,
          alreadyPresent: out.alreadyPresent,
          written: out.written,
          writtenUnread: out.writtenUnread,
          unresolved: out.unresolved.length,
          ranAt: new Date().toISOString(),
        },
      },
    }).catch(() => {
      // An ActivityLog shape that does not accept this row must not roll back
      // a correct migration; the JSON report is the other copy of the record.
    });
  });

  return out;
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function print(report: Report) {
  console.log(`\nMentions backfill — ${report.write ? "WRITE" : "dry run"}`);
  console.log(`Database: ${report.database}`);
  console.log(`Anything last edited before ${report.unreadDays} days ago is written READ.\n`);
  console.log("  organization                    links  mentions  present  written");
  for (const o of report.orgs) {
    if (o.linksRead === 0 && o.mentionsFound === 0) continue;
    console.log(
      `  ${o.organizationName.slice(0, 30).padEnd(30)} ${String(o.linksRead).padStart(5)} ` +
      `${String(o.mentionsFound).padStart(9)} ${String(o.alreadyPresent).padStart(8)} ${String(o.written).padStart(8)}`,
    );
  }
  console.log(
    `\n  TOTALS  links ${report.totals.linksRead} · mentions ${report.totals.mentionsFound} · ` +
    `already present ${report.totals.alreadyPresent} · written ${report.totals.written}`,
  );

  const unresolved = report.orgs.flatMap((o) => o.unresolved.map((u) => ({ org: o.organizationName, ...u })));
  if (unresolved.length) {
    console.log(`\n  ${unresolved.length} link(s) could not be resolved. NOTHING was written for these,`);
    console.log(`  and nothing was deleted. Read them before approving a production run:`);
    for (const u of unresolved.slice(0, 40)) {
      console.log(`    ${u.org} · ${u.sourceType} ${u.sourceId} · ${u.reason}`);
    }
    if (unresolved.length > 40) console.log(`    … and ${unresolved.length - 40} more (see the JSON report)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
