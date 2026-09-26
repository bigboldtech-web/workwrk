// Phase 7 (AI and automation), stage A: the legacy Autopilot rows.
//
// WHAT THESE ROWS ARE. Before the Automation hub (AutomationWorkflow, the
// engine in src/lib/automation), the /autopilot mock sat on a Workflow row
// with kind AUTOMATION, created and toggled by /api/autopilot/workflows. That
// page and that API are deleted in this stage (spec-ai-automation section 0
// and section 4 step 1), and the runtime that would have run the rows
// (src/lib/workflows/runtime.ts triggerEvent) has had zero callers for a long
// time. So nothing reads these rows and nothing ever executed them. The
// APPROVAL rows in the same table are live and are never touched here.
//
// WHAT IT DOES.
//   Dry run (the default): prints, per organization, the AUTOMATION rows and
//   their WorkflowRun counts. Writes nothing.
//   --export <file>: also writes every AUTOMATION row, with its runs, as JSON
//   to <file>. This is the undo: --restore <file> recreates them exactly.
//   --write: deletes the AUTOMATION rows (their WorkflowRun rows cascade) and
//   REQUIRES --export in the same run, so a delete never happens without the
//   copy that reverses it. It then re-counts and asserts zero remain.
//   --restore <file>: recreates rows from an export, skipping any id that
//   already exists. Idempotent and all or nothing: every missing row (with
//   its runs) is created in ONE transaction, after a pre-check that no live
//   row already holds one of their (organizationId, name) pairs, so a
//   collision aborts before anything is written instead of partway through.
//
// The delete only removes rows whose ids are in the export it just wrote,
// and refuses to run when the export and the report disagree (a row created
// between the two), so every deleted row is in the undo file.
//
// Never touches kind APPROVAL. Idempotent: a second --write finds nothing.
//
// Usage (local):
//   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
//     npx tsx scripts/cleanup-legacy-automation-workflows.ts
//   ... --export /path/legacy-automation.json --write
//   ... --restore /path/legacy-automation.json

import { readFileSync, writeFileSync } from "node:fs";
import { scriptPrisma, databaseLabel } from "./lib/script-prisma";

const prisma = scriptPrisma();
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
};

function line(s = "") { process.stdout.write(`${s}\n`); }

type Exported = {
  exportedAt: string;
  workflows: Array<Record<string, unknown> & { id: string; runs: Array<Record<string, unknown> & { id: string }> }>;
};

async function report() {
  const rows = await prisma.workflow.findMany({
    where: { kind: "AUTOMATION" },
    select: { id: true, organizationId: true, name: true, triggerEvent: true, active: true, createdAt: true, _count: { select: { runs: true } } },
    orderBy: [{ organizationId: "asc" }, { createdAt: "asc" }],
  });
  const approvals = await prisma.workflow.count({ where: { kind: "APPROVAL" } });
  const byOrg = new Map<string, typeof rows>();
  for (const r of rows) byOrg.set(r.organizationId, [...(byOrg.get(r.organizationId) ?? []), r]);
  line(`legacy Autopilot rows (Workflow kind AUTOMATION) on ${databaseLabel()}`);
  line(`APPROVAL rows (untouched, reported only): ${approvals}`);
  line(`AUTOMATION rows: ${rows.length} across ${byOrg.size} organization(s)`);
  for (const [org, list] of byOrg) {
    line(`  org ${org}: ${list.length} row(s), ${list.reduce((n, r) => n + r._count.runs, 0)} run(s)`);
    for (const r of list) line(`    ${r.id}  "${r.name}"  trigger=${r.triggerEvent ?? "none"}  active=${r.active}  runs=${r._count.runs}`);
  }
  return rows;
}

async function exportTo(file: string) {
  const workflows = await prisma.workflow.findMany({ where: { kind: "AUTOMATION" }, include: { runs: true } });
  const payload: Exported = { exportedAt: new Date().toISOString(), workflows: workflows as unknown as Exported["workflows"] };
  writeFileSync(file, JSON.stringify(payload, null, 2));
  line(`exported ${workflows.length} row(s) with ${workflows.reduce((n, w) => n + w.runs.length, 0)} run(s) to ${file}`);
  return workflows.map((w) => w.id);
}

async function restore(file: string) {
  const payload = JSON.parse(readFileSync(file, "utf8")) as Exported;
  const ids = payload.workflows.map((w) => w.id);
  const present = new Set(
    (await prisma.workflow.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id),
  );
  const missing = payload.workflows.filter((w) => !present.has(w.id));
  // Pre-check the (organizationId, name) unique key, so a collision aborts
  // before the first write rather than partway through.
  const clashes: string[] = [];
  for (const w of missing) {
    const clash = await prisma.workflow.findFirst({
      where: { organizationId: w.organizationId as string, name: w.name as string },
      select: { id: true },
    });
    if (clash) clashes.push(`${w.id} "${String(w.name)}" (org ${String(w.organizationId)}) clashes with live row ${clash.id}`);
  }
  if (clashes.length > 0) {
    for (const c of clashes) line(`  ${c}`);
    throw new Error(`restore aborted, nothing written: ${clashes.length} row(s) would collide on (organizationId, name). Rename the live rows, then run --restore again.`);
  }
  await prisma.$transaction(async (tx) => {
    for (const w of missing) {
      const { runs, ...row } = w;
      await tx.workflow.create({ data: row as never });
      for (const run of runs) await tx.workflowRun.create({ data: run as never });
    }
  });
  line(`restore: ${missing.length} row(s) recreated, ${present.size} already present`);
}

async function main() {
  const restoreFile = value("--restore");
  if (restoreFile) {
    await restore(restoreFile);
    await report();
    return;
  }
  const rows = await report();
  const exportFile = value("--export");
  const exportedIds = exportFile ? await exportTo(exportFile) : null;
  if (!flag("--write")) {
    line();
    line("dry run: nothing deleted. Pass --export <file> --write to delete (the export is the undo).");
    return;
  }
  if (!exportFile || !exportedIds) throw new Error("--write needs --export <file> in the same run: the export is how this is reversed.");
  // Every row about to go must be in the undo file, and the file must hold
  // exactly what the report counted.
  const exported = new Set(exportedIds);
  const notExported = rows.filter((r) => !exported.has(r.id)).map((r) => r.id);
  if (exportedIds.length !== rows.length || notExported.length > 0) {
    throw new Error(`export (${exportedIds.length}) and report (${rows.length}) disagree${notExported.length ? `; not exported: ${notExported.join(", ")}` : ""}. Nothing deleted: run again.`);
  }
  const deleted = await prisma.workflow.deleteMany({ where: { kind: "AUTOMATION", id: { in: exportedIds } } });
  const left = await prisma.workflow.count({ where: { kind: "AUTOMATION" } });
  line(`deleted ${deleted.count} AUTOMATION row(s); remaining: ${left}`);
  if (left !== 0) throw new Error(`expected 0 AUTOMATION rows after the delete, found ${left}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
