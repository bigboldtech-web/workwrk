// The one-time ItemCompletion backfill (docs/plans/recurring-goals.md C4,
// section 5 founder step 3). Run ONCE by the founder after step 4 ships,
// dry run first.
//
// WHAT IT WRITES. Every task now in a done status of its List (isDoneStatus)
// gets ONE completion, at the time of its LAST not-done-to-done
// STATUS_CHANGED activity, when it has no completion at or after that
// moment. A Done to Closed change is no such activity (both are done). A task
// with no such activity gets NO row: it was done before any goal could count
// it, and the report counts those. Nothing is ever deleted or changed.
//
// THE RULES (scripts/MIGRATIONS.md):
//   1. DRY RUN BY DEFAULT. --write writes; without it nothing is written.
//   2. A JSON REPORT FIRST, per organization, printed either way (and saved
//      with --report=<path>).
//   3. IT ASSERTS. After a write the candidates are counted again and must
//      be zero; a mismatch exits 1.
//   4. IT IS IDEMPOTENT. A task that already has a completion at or after
//      its last entry into done is skipped, so a second run writes nothing.
//   5. IT INVENTS NOTHING: no activity, no row.
//   6. IT IS SAFE AGAINST AN OLD DATABASE: without the "ItemCompletion" table
//      (prisma/sql/2026-10-27-item-completions.sql not applied) it says so
//      and exits 0 without writing.
//   7. IT WRITES PAGE BY PAGE, EACH TASK CHECKED AGAIN (final review L5).
//      A page of tasks is planned, then written at once, in a transaction
//      that locks the page's tasks FOR UPDATE (as every status write does)
//      and reads them again: a task reopened, moved, or given a completion
//      by a person since the plan is skipped (and counted as changedSince),
//      so a long run never writes a completion for a task no longer done.
//
// Usage:
//   npx tsx scripts/backfill-item-completions.ts                  dry run, every organization
//   npx tsx scripts/backfill-item-completions.ts --org=<id>       one organization
//   npx tsx scripts/backfill-item-completions.ts --write          write
//   npx tsx scripts/backfill-item-completions.ts --report=<file>  also save the report
//
// It runs only when executed directly; importing it does nothing.
// DATABASE_URL comes from .env.local, then .env.

import { writeFileSync } from "node:fs";
import type { PrismaClient as Client } from "../src/generated/prisma";
import { getBoardStatuses, isDoneStatus, type StatusOption } from "../src/lib/board-items-shared";

/** The candidate's facts, as the plan reads them (pure). */
export interface BackfillTask {
  id: string;
  boardId: string;
  organizationId: string;
  status: string | null;
  statuses: readonly StatusOption[];
  /** Its STATUS_CHANGED activity rows, any order. */
  changes: ReadonlyArray<{ from: string | null; to: string | null; at: Date }>;
  /** Its newest completion, if any. */
  latestCompletion: Date | null;
}

export type BackfillVerdict =
  | { kind: "write"; doneAt: Date }
  | { kind: "has_row" }
  | { kind: "no_activity" }
  | { kind: "not_done" };

/** What the backfill does with one task (pure). */
export function backfillVerdict(t: BackfillTask): BackfillVerdict {
  if (!isDoneStatus(t.statuses, t.status)) return { kind: "not_done" };
  let last: Date | null = null;
  for (const c of t.changes) {
    if (isDoneStatus(t.statuses, c.from) || !isDoneStatus(t.statuses, c.to)) continue;
    if (!last || c.at.getTime() > last.getTime()) last = c.at;
  }
  if (!last) return { kind: "no_activity" };
  // A writer stamps its row a moment before the activity row is written.
  if (t.latestCompletion && t.latestCompletion.getTime() >= last.getTime() - 60_000) return { kind: "has_row" };
  return { kind: "write", doneAt: last };
}

const PAGE = 1000;

export interface OrgReport {
  organizationId: string;
  doneTasks: number;
  toWrite: number;
  alreadyHadRow: number;
  noActivity: number;
  written: number;
  /** Planned, then skipped at the write: the task changed since (reopened, moved, or given a completion). */
  changedSince: number;
}

type PlannedRow = { itemId: string; boardId: string; organizationId: string; status: string; doneAt: Date; actorId: null };

async function main(): Promise<void> {
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: ".env.local" });
  loadEnv();
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("../src/generated/prisma");
  const prisma: Client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const WRITE = process.argv.includes("--write");
  const arg = (name: string): string | null => {
    const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
    return eq ? eq.slice(name.length + 3) : null;
  };
  const ORG = arg("org");
  const REPORT = arg("report");

  try {
    const table = await prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT to_regclass('"ItemCompletion"') IS NOT NULL AS ok`;
    if (!table[0]?.ok) {
      console.log(JSON.stringify({ ok: true, skipped: "The ItemCompletion table is not there yet: apply prisma/sql/2026-10-27-item-completions.sql first." }, null, 2));
      return;
    }
    const orgs = ORG ? [{ id: ORG }] : await prisma.organization.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    const reports: OrgReport[] = [];
    let mismatch = false;
    for (const org of orgs) {
      const report = await backfillOrg(prisma, org.id, { write: WRITE });
      if (WRITE && report.written > 0) {
        // Rule 3: nothing left to write.
        const again = await backfillOrg(prisma, org.id, { write: false });
        if (again.toWrite !== 0) mismatch = true;
      }
      reports.push(report);
    }
    const total = reports.reduce((t, r) => ({
      doneTasks: t.doneTasks + r.doneTasks, toWrite: t.toWrite + r.toWrite, alreadyHadRow: t.alreadyHadRow + r.alreadyHadRow,
      noActivity: t.noActivity + r.noActivity, written: t.written + r.written, changedSince: t.changedSince + r.changedSince,
    }), { doneTasks: 0, toWrite: 0, alreadyHadRow: 0, noActivity: 0, written: 0, changedSince: 0 });
    const out = { mode: WRITE ? "write" : "dry run", at: new Date().toISOString(), total, organizations: reports.filter((r) => r.doneTasks > 0) };
    const json = JSON.stringify(out, null, 2);
    console.log(json);
    if (REPORT) writeFileSync(REPORT, json);
    if (mismatch) {
      console.error("backfill-item-completions: rows are still missing after the write.");
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * One organization, a page of tasks at a time: each page is planned
 * (backfillVerdict), and with `write` its rows are written straight away by
 * writePage, never after the whole organization has been read. Returns the
 * report.
 */
export async function backfillOrg(prisma: Client, organizationId: string, opts: { write: boolean }): Promise<OrgReport> {
  const report: OrgReport = { organizationId, doneTasks: 0, toWrite: 0, alreadyHadRow: 0, noActivity: 0, written: 0, changedSince: 0 };
  const boards = await prisma.board.findMany({ where: { organizationId }, select: { id: true, statuses: true } });
  const statusesOf = new Map(boards.map((b) => [b.id, getBoardStatuses(b)]));
  let cursor: string | null = null;
  for (;;) {
    const tasks: Array<{ id: string; boardId: string; status: string | null }> = await prisma.item.findMany({
      where: { organizationId, status: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: PAGE,
      select: { id: true, boardId: true, status: true },
    });
    if (tasks.length === 0) break;
    cursor = tasks[tasks.length - 1].id;
    const rows = await planPage(prisma, organizationId, tasks, statusesOf, report);
    if (opts.write && rows.length > 0) {
      const w = await writePage(prisma, rows, statusesOf);
      report.written += w.written;
      report.changedSince += w.changedSince;
    }
    if (tasks.length < PAGE) break;
  }
  return report;
}

/** One page's rows to write (the verdicts counted on the report). */
async function planPage(
  prisma: Client,
  organizationId: string,
  tasks: ReadonlyArray<{ id: string; boardId: string; status: string | null }>,
  statusesOf: ReadonlyMap<string, StatusOption[]>,
  report: OrgReport,
): Promise<PlannedRow[]> {
  const rows: PlannedRow[] = [];
  const done = tasks.filter((t) => isDoneStatus(statusesOf.get(t.boardId) ?? getBoardStatuses(null), t.status));
  if (done.length === 0) return rows;
  const ids = done.map((t) => t.id);
  const [acts, latest] = await Promise.all([
    prisma.itemActivity.findMany({
      where: { organizationId, entityType: "BOARD_ITEM", entityId: { in: ids }, action: "STATUS_CHANGED" },
      select: { entityId: true, meta: true, createdAt: true },
    }),
    prisma.itemCompletion.findMany({ where: { itemId: { in: ids } }, orderBy: { doneAt: "desc" }, distinct: ["itemId"], select: { itemId: true, doneAt: true } }),
  ]);
  const changesOf = new Map<string, Array<{ from: string | null; to: string | null; at: Date }>>();
  for (const a of acts) {
    const m = a.meta && typeof a.meta === "object" && !Array.isArray(a.meta) ? (a.meta as Record<string, unknown>) : {};
    const list = changesOf.get(a.entityId) ?? [];
    list.push({ from: typeof m.from === "string" ? m.from : null, to: typeof m.to === "string" ? m.to : null, at: a.createdAt });
    changesOf.set(a.entityId, list);
  }
  const lastOf = new Map(latest.map((c) => [c.itemId, c.doneAt]));
  for (const t of done) {
    report.doneTasks += 1;
    const v = backfillVerdict({
      id: t.id, boardId: t.boardId, organizationId, status: t.status,
      statuses: statusesOf.get(t.boardId) ?? getBoardStatuses(null),
      changes: changesOf.get(t.id) ?? [], latestCompletion: lastOf.get(t.id) ?? null,
    });
    if (v.kind === "write") {
      report.toWrite += 1;
      rows.push({ itemId: t.id, boardId: t.boardId, organizationId, status: t.status ?? "", doneAt: v.doneAt, actorId: null });
    } else if (v.kind === "has_row") report.alreadyHadRow += 1;
    else if (v.kind === "no_activity") report.noActivity += 1;
  }
  return rows;
}

/**
 * Rule 7: one page's planned rows, written in ONE transaction that first
 * locks the page's tasks FOR UPDATE (in id order, as a move locks its
 * subtasks, so it waits for a status write in flight and blocks the next)
 * and reads them again. A row is written only while its task still sits in
 * the List and the done status it was planned with, and still has no
 * completion at or after the planned time; every other one is skipped and
 * counted (changedSince).
 */
export async function writePage(
  prisma: Client,
  rows: readonly PlannedRow[],
  statusesOf: ReadonlyMap<string, StatusOption[]>,
): Promise<{ written: number; changedSince: number }> {
  if (rows.length === 0) return { written: 0, changedSince: 0 };
  const ids = [...new Set(rows.map((r) => r.itemId))].sort();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id, status FROM "Item" WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE`;
    const [now, latest] = await Promise.all([
      tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, boardId: true, status: true } }),
      tx.itemCompletion.findMany({ where: { itemId: { in: ids } }, orderBy: { doneAt: "desc" }, distinct: ["itemId"], select: { itemId: true, doneAt: true } }),
    ]);
    const nowOf = new Map(now.map((t) => [t.id, t]));
    const lastOf = new Map(latest.map((c) => [c.itemId, c.doneAt]));
    const keep = rows.filter((r) => {
      const t = nowOf.get(r.itemId);
      if (!t || t.boardId !== r.boardId || (t.status ?? "") !== r.status) return false;
      if (!isDoneStatus(statusesOf.get(t.boardId) ?? getBoardStatuses(null), t.status)) return false;
      const last = lastOf.get(r.itemId);
      return !last || last.getTime() < r.doneAt.getTime() - 60_000;
    });
    let written = 0;
    for (let i = 0; i < keep.length; i += 500) written += (await tx.itemCompletion.createMany({ data: keep.slice(i, i + 500) })).count;
    return { written, changedSince: rows.length - keep.length };
  }, { timeout: 60_000, maxWait: 10_000 });
}

if (/backfill-item-completions\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
