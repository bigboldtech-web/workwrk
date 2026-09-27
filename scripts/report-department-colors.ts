// Phase 6: the Department.color hue remap, REPORT ONLY (spec-teams-people
// section 4 "Data migrations": "Department.color hex -> the eight-hue index,
// design-system 1.7 dry-run remap"). It prints, per organization, what every
// department's colour is today (legacy hex, CSS var from the dialog, empty)
// and the index it WOULD become through src/lib/people/department-hue.ts.
//
// It never writes. The write lands with the Departments rebuild (T2), whose
// picker stores the index and whose readers accept all three encodings
// during the rollout. Rows it cannot map are listed, never guessed.
//
// Usage:
//   npx tsx scripts/report-department-colors.ts [--org=<id>] [--report=<file>]

import { writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";
import { USER_HUES, departmentHue } from "../src/lib/people/department-hue";

loadEnv({ path: ".env.local" });
loadEnv();

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const arg = (name: string): string | null => {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
};
const ORG = arg("org");
const REPORT = arg("report");
const out: string[] = [];
const line = (s = "") => { out.push(s); process.stdout.write(`${s}\n`); };

async function main() {
  line(`Department.color remap: REPORT ONLY, nothing is written · ${new Date().toISOString()}`);
  const orgs = await prisma.organization.findMany({ where: ORG ? { id: ORG } : {}, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const totals: Record<string, number> = { empty: 0, index: 0, "css-var": 0, hex: 0, unknown: 0, collisions: 0 };
  for (const org of orgs) {
    const depts = await prisma.department.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" } });
    line("");
    line(`Organization ${org.name} (${org.id}) · ${depts.length} departments`);
    const byHue = new Map<number, string[]>();
    for (const d of depts) {
      const r = departmentHue(d.color);
      totals[r.kind] += 1;
      const hue = r.index ? USER_HUES[r.index - 1].name : "none";
      if (r.index) byHue.set(r.index, [...(byHue.get(r.index) ?? []), d.name]);
      line(`  ${d.name.padEnd(28)} ${String(d.color ?? "null").padEnd(22)} ${r.kind.padEnd(8)} -> ${r.index ?? "-"} ${hue}${r.kind === "unknown" ? "   UNMAPPED, left as is" : ""}`);
    }
    // Two legacy colours that fall into one hue draw identical dots, so the
    // colour stops telling those departments apart. Flag them for a person
    // to re-pick in the Departments drawer; the remap never guesses.
    for (const [index, names] of byHue) {
      if (names.length < 2) continue;
      totals.collisions = (totals.collisions ?? 0) + 1;
      line(`  COLLISION: ${USER_HUES[index - 1].name} is shared by ${names.join(", ")}. Pick distinct colours in Teams > Departments.`);
    }
  }
  line("");
  line(`Totals: ${Object.entries(totals).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
}

main()
  .then(async () => { if (REPORT) writeFileSync(REPORT, `${out.join("\n")}\n`); await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
