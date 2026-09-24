/**
 * report-access-grants-tables-forms.ts: the DRY-RUN report for the access
 * grants backfill that Tables and Forms need (spec-tables-forms section 4,
 * step 1, and data migration (a): "a dry-run report per org listing every
 * table that becomes Everyone at {org} Can edit, every form's resolved anchor
 * and every form whose creator gains an explicit Full access row, approved
 * before the write").
 *
 * THIS SCRIPT NEVER WRITES. There is nowhere to write to yet: the AccessGrant
 * store (access-model-spec step 4) does not exist in prisma/schema.prisma, and
 * src/lib/access stays inert until the engine flips (Phase 8). The write will
 * be a separate script run then, from this report, after the founder approves
 * it. Passing --write is refused so nobody mistakes this for that.
 *
 * WHAT IT REPORTS, per organization:
 *   1. Tables. A table with no Space is org-wide today (any member reads and
 *      writes it), so the backfill writes "Everyone at {org} · Can edit" for
 *      it and nobody loses an ability on the day the engine lands. A table in
 *      a Space inherits the Space and needs no Everyone row. Every table's
 *      creator gains an explicit Full row (creator Full for life, access 3.3).
 *   2. Forms. Each form's resolved anchor under change request T2: the List it
 *      feeds (targetBoardId), else the Table (targetTableId), else none. A
 *      form with no destination resolves to creator Full plus Admin Full. A
 *      destination that no longer exists is named, because it resolves to none.
 *      Every form's creator gains an explicit Full row.
 *   3. Public links. Every table and form with isPublic on, and the org's
 *      toggle 10 value, so the founder sees which live links a strict "absent
 *      means off" reading would switch off (Phase 5 reads absent as view).
 *   4. Problems: creators who no longer exist or are deactivated (their Full
 *      row would name a ghost; the report names them so an Owner can be made
 *      the holder instead).
 *
 * Usage:
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/report-access-grants-tables-forms.ts --report <file.md>
 *   ... --org <organizationId>     one org only
 */

import fs from "node:fs";
import path from "node:path";
import { databaseLabel, scriptPrisma } from "./lib/script-prisma";

const args = process.argv.slice(2);
if (args.includes("--write")) {
  console.error("report-access-grants-tables-forms: this script is a dry run only and never writes. The grants write ships with the access engine flip (Phase 8).");
  process.exit(2);
}
const reportPath = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;
const onlyOrg = args.includes("--org") ? args[args.indexOf("--org") + 1] : null;

const prisma = scriptPrisma();

function publicLinksValue(settings: unknown): string {
  const v = (settings as { access?: { publicLinks?: unknown } } | null)?.access?.publicLinks;
  return typeof v === "string" ? v : "(absent)";
}

async function main() {
  const lines: string[] = [];
  const out = (s = "") => { lines.push(s); console.log(s); };

  out(`# Access grants backfill for Tables and Forms: DRY RUN`);
  out();
  out(`Database: ${databaseLabel()}  `);
  out(`Generated: ${new Date().toISOString()}  `);
  out(`Writes: none (this report never writes; the write ships with the engine flip)`);
  out();

  const orgs = await prisma.organization.findMany({
    where: onlyOrg ? { id: onlyOrg } : {},
    select: { id: true, name: true, settings: true },
    orderBy: { name: "asc" },
  });

  const totals = { orgs: 0, tables: 0, everyoneEdit: 0, spaceInherit: 0, forms: 0, formList: 0, formTable: 0, formNone: 0, formBroken: 0, creatorFull: 0, ghosts: 0, publicTables: 0, publicForms: 0 };

  for (const org of orgs) {
    const [tables, forms] = await Promise.all([
      prisma.dataTable.findMany({
        where: { organizationId: org.id },
        select: { id: true, name: true, spaceId: true, createdById: true, isPublic: true },
        orderBy: { name: "asc" },
      }),
      prisma.formDefinition.findMany({
        where: { organizationId: org.id },
        select: { id: true, name: true, targetBoardId: true, targetTableId: true, createdById: true, isPublic: true },
        orderBy: { name: "asc" },
      }),
    ]);
    if (tables.length === 0 && forms.length === 0) continue;
    totals.orgs += 1;

    const spaceIds = [...new Set(tables.map((t) => t.spaceId).filter((x): x is string => !!x))];
    const boardIds = [...new Set(forms.map((f) => f.targetBoardId).filter((x): x is string => !!x))];
    const creatorIds = [...new Set([...tables.map((t) => t.createdById), ...forms.map((f) => f.createdById)].filter(Boolean))];
    const [spaces, boards, creators] = await Promise.all([
      prisma.space.findMany({ where: { id: { in: spaceIds } }, select: { id: true, name: true } }),
      prisma.board.findMany({ where: { id: { in: boardIds } }, select: { id: true, name: true, organizationId: true } }),
      prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, firstName: true, lastName: true, email: true, deletedAt: true, status: true } }),
    ]);
    const spaceName = new Map(spaces.map((s) => [s.id, s.name]));
    const boardById = new Map(boards.map((b) => [b.id, b]));
    const tableName = new Map(tables.map((t) => [t.id, t.name]));
    const creatorById = new Map(creators.map((u) => [u.id, u]));
    const who = (id: string) => {
      const u = creatorById.get(id);
      if (!u) return `(missing user ${id})`;
      const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
      return u.deletedAt || u.status !== "ACTIVE" ? `${name} (INACTIVE)` : name;
    };
    const isGhost = (id: string) => { const u = creatorById.get(id); return !u || !!u.deletedAt || u.status !== "ACTIVE"; };

    out(`## ${org.name} (${org.id})`);
    out();
    out(`Toggle 10 (settings.access.publicLinks): ${publicLinksValue(org.settings)}`);
    out();

    out(`### Tables (${tables.length})`);
    out();
    out(`| Table | Anchor | Grant the backfill writes | Creator gains Full | Public link |`);
    out(`|---|---|---|---|---|`);
    for (const t of tables) {
      totals.tables += 1;
      totals.creatorFull += 1;
      if (t.isPublic) totals.publicTables += 1;
      if (isGhost(t.createdById)) totals.ghosts += 1;
      let anchor: string;
      let grant: string;
      if (t.spaceId) {
        totals.spaceInherit += 1;
        anchor = `Space "${spaceName.get(t.spaceId) ?? `(missing ${t.spaceId})`}"`;
        grant = "none (inherits the Space)";
      } else {
        totals.everyoneEdit += 1;
        anchor = "standalone";
        grant = `Everyone at ${org.name} · Can edit`;
      }
      out(`| ${t.name || "Untitled table"} (${t.id}) | ${anchor} | ${grant} | ${who(t.createdById)} | ${t.isPublic ? "on" : "off"} |`);
    }
    out();

    out(`### Forms (${forms.length})`);
    out();
    out(`| Form | Resolved anchor (T2) | Creator gains Full | Public link | Note |`);
    out(`|---|---|---|---|---|`);
    for (const f of forms) {
      totals.forms += 1;
      totals.creatorFull += 1;
      if (f.isPublic) totals.publicForms += 1;
      if (isGhost(f.createdById)) totals.ghosts += 1;
      let anchor: string;
      let note = "";
      if (f.targetBoardId) {
        const b = boardById.get(f.targetBoardId);
        if (b && b.organizationId === org.id) { anchor = `List "${b.name}"`; totals.formList += 1; }
        else { anchor = "none"; note = `destination List ${f.targetBoardId} no longer exists`; totals.formBroken += 1; totals.formNone += 1; }
        if (f.targetTableId) note = `${note ? `${note}; ` : ""}also feeds Table "${tableName.get(f.targetTableId) ?? f.targetTableId}" (the List wins as the anchor)`;
      } else if (f.targetTableId) {
        const tn = tableName.get(f.targetTableId);
        if (tn !== undefined) { anchor = `Table "${tn || "Untitled table"}"`; totals.formTable += 1; }
        else { anchor = "none"; note = `destination Table ${f.targetTableId} no longer exists`; totals.formBroken += 1; totals.formNone += 1; }
      } else {
        anchor = "none";
        note = "no destination: creator Full plus Admin Full once the engine flips (Members keep today's reach until then)";
        totals.formNone += 1;
      }
      out(`| ${f.name || "Untitled form"} (${f.id}) | ${anchor} | ${who(f.createdById)} | ${f.isPublic ? "on" : "off"} | ${note} |`);
    }
    out();
  }

  out(`## Totals`);
  out();
  out(`- Organizations with tables or forms: ${totals.orgs}`);
  out(`- Tables: ${totals.tables} (Everyone · Can edit rows to write: ${totals.everyoneEdit}; inherit a Space: ${totals.spaceInherit})`);
  out(`- Forms: ${totals.forms} (anchored to a List: ${totals.formList}; to a Table: ${totals.formTable}; no anchor: ${totals.formNone}, of which a destination that no longer exists: ${totals.formBroken})`);
  out(`- Explicit creator Full rows to write: ${totals.creatorFull}`);
  out(`- Creators who are missing or inactive (resolve before the write): ${totals.ghosts}`);
  out(`- Live public links: ${totals.publicTables} tables, ${totals.publicForms} forms`);

  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, lines.join("\n") + "\n");
    console.log(`\nReport saved to ${reportPath}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
