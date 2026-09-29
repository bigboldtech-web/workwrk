// Phase 6 (people) data backfills, the three spec-named ones, in one script.
//
//   --step=talent-source      TalentAssessment.source = 'SCORES' where the
//                             placement was made by the old auto-place
//                             (notes = 'Auto-placed from performance score')
//                             and source is still the column default MANUAL.
//   --step=survey-creator     PulseSurvey.createdById from the earliest
//                             ActivityLog row of type 'survey_created' for
//                             that survey, when one exists and its actor is
//                             a member of the survey's org. NOTE: releases
//                             before Phase 6 never wrote that log, so in
//                             practice this step reports every older survey
//                             as "no log, left null"; it is kept so a log
//                             written by any other path is honoured. From
//                             Phase 6 POST /api/pulse-surveys stamps the
//                             creator itself. A null creator keeps the
//                             survey with the People team, Admin and the
//                             manager tier that could manage it yesterday
//                             (survey-audience.ts canManageSurvey).
//   --step=cycle-creator      ReviewCycle.createdById from the earliest
//                             ActivityLog row of type 'review_cycle.create'
//                             (written by POST /api/reviews since before
//                             Phase 6) whose actor is a member of the org,
//                             so the manager who started a cycle keeps it.
//                             Left null otherwise (People team and Admin).
//   --step=dept-goal-assignees  one GoalAssignee { okrId, departmentId } for
//                             every DEPARTMENT goal with a departmentId and
//                             no audience row for that department, so the
//                             goal keeps appearing in its department's My
//                             goals (spec-goals section 4, data migrations).
//   --step=all                the four, in that order (the default).
//
// THE SEVEN RULES (scripts/MIGRATIONS.md):
//   1. DRY RUN BY DEFAULT. --write writes; without it nothing is written.
//   2. A PER-ORGANIZATION REPORT is printed either way (and saved with
//      --report=<path>).
//   3. IT ASSERTS. After a write the remaining candidates for each step are
//      counted again and must be zero; a mismatch exits 1.
//   4. IT IS IDEMPOTENT. Every step selects only rows it has not handled, so
//      a second run finds nothing to do.
//   5. IT NEVER DELETES OR MUTATES A SOURCE ROW beyond the one field each
//      step names, which was at its default.
//   6. IT IS SAFE AGAINST AN OLD DATABASE. If the Phase 6 columns are absent
//      (prisma/sql/2026-09-26-phase6-people.sql not applied) it says so and
//      exits 0 without writing.
//   7. IT INVENTS NOTHING. A survey with no creation log keeps a null
//      creator; a goal's audience row names the goal's own department.
//
// Usage:
//   npx tsx scripts/backfill-phase6-people.ts                       dry run, all steps
//   npx tsx scripts/backfill-phase6-people.ts --step=talent-source  one step
//   npx tsx scripts/backfill-phase6-people.ts --write               write
//   npx tsx scripts/backfill-phase6-people.ts --org=<id>            one organization
//   npx tsx scripts/backfill-phase6-people.ts --report=<file>       also save the report
//
// DATABASE_URL comes from .env.local, then .env. Production runs are the
// founder's: see scripts/MIGRATIONS.md, Phase 6.

import { writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";

loadEnv({ path: ".env.local" });
loadEnv();

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const WRITE = process.argv.includes("--write");
const arg = (name: string): string | null => {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : null;
};
const ORG = arg("org");
const STEP = arg("step") ?? "all";
const REPORT = arg("report");
const AUTO_NOTE = "Auto-placed from performance score";

const out: string[] = [];
function line(s = "") {
  out.push(s);
  process.stdout.write(`${s}\n`);
}

async function columnsPresent(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM information_schema.columns
    WHERE (table_name = 'TalentAssessment' AND column_name = 'source')
       OR (table_name = 'PulseSurvey' AND column_name = 'createdById')
       OR (table_name = 'ReviewCycle' AND column_name = 'createdById')`;
  return Number(rows[0]?.n ?? 0) === 3;
}

async function orgs(): Promise<{ id: string; name: string }[]> {
  return prisma.organization.findMany({
    where: ORG ? { id: ORG } : {},
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function talentSource(orgId: string): Promise<{ candidates: number; written: number; remaining: number }> {
  const where = { organizationId: orgId, notes: AUTO_NOTE, source: "MANUAL" };
  const candidates = await prisma.talentAssessment.count({ where });
  let written = 0;
  if (WRITE && candidates > 0) {
    written = (await prisma.talentAssessment.updateMany({ where, data: { source: "SCORES" } })).count;
  }
  const remaining = WRITE ? await prisma.talentAssessment.count({ where }) : candidates;
  return { candidates, written, remaining };
}

async function surveyCreator(orgId: string): Promise<{ candidates: number; found: number; written: number; noLog: number }> {
  const surveys = await prisma.pulseSurvey.findMany({
    where: { organizationId: orgId, createdById: null },
    select: { id: true },
  });
  let found = 0;
  let written = 0;
  let noLog = 0;
  for (const s of surveys) {
    const log = await prisma.activityLog.findFirst({
      where: { organizationId: orgId, type: "survey_created", targetId: s.id },
      orderBy: { createdAt: "asc" },
      select: { actorId: true },
    });
    const actor = log?.actorId
      ? await prisma.user.findFirst({ where: { id: log.actorId, organizationId: orgId }, select: { id: true } })
      : null;
    if (!actor) { noLog += 1; continue; }
    found += 1;
    if (WRITE) {
      const r = await prisma.pulseSurvey.updateMany({ where: { id: s.id, createdById: null }, data: { createdById: actor.id } });
      written += r.count;
    }
  }
  return { candidates: surveys.length, found, written, noLog };
}

async function cycleCreator(orgId: string): Promise<{ candidates: number; found: number; written: number; noLog: number }> {
  const cycles = await prisma.reviewCycle.findMany({
    where: { organizationId: orgId, createdById: null },
    select: { id: true },
  });
  let found = 0;
  let written = 0;
  let noLog = 0;
  for (const c of cycles) {
    const log = await prisma.activityLog.findFirst({
      where: { organizationId: orgId, type: "review_cycle.create", targetId: c.id },
      orderBy: { createdAt: "asc" },
      select: { actorId: true },
    });
    const actor = log?.actorId
      ? await prisma.user.findFirst({ where: { id: log.actorId, organizationId: orgId }, select: { id: true } })
      : null;
    if (!actor) { noLog += 1; continue; }
    found += 1;
    if (WRITE) {
      const r = await prisma.reviewCycle.updateMany({ where: { id: c.id, createdById: null }, data: { createdById: actor.id } });
      written += r.count;
    }
  }
  return { candidates: cycles.length, found, written, noLog };
}

async function deptGoalCandidates(orgId: string): Promise<{ okrId: string; departmentId: string }[]> {
  const goals = await prisma.oKR.findMany({
    where: { organizationId: orgId, level: "DEPARTMENT", departmentId: { not: null } },
    select: { id: true, departmentId: true },
  });
  if (goals.length === 0) return [];
  const existing = await prisma.goalAssignee.findMany({
    where: { okrId: { in: goals.map((g) => g.id) }, departmentId: { not: null } },
    select: { okrId: true, departmentId: true },
  });
  const have = new Set(existing.map((e) => `${e.okrId}:${e.departmentId}`));
  return goals
    .filter((g) => g.departmentId && !have.has(`${g.id}:${g.departmentId}`))
    .map((g) => ({ okrId: g.id, departmentId: g.departmentId as string }));
}

async function deptGoalAssignees(orgId: string): Promise<{ candidates: number; written: number; remaining: number }> {
  const todo = await deptGoalCandidates(orgId);
  let written = 0;
  if (WRITE && todo.length > 0) {
    written = (await prisma.goalAssignee.createMany({ data: todo })).count;
  }
  const remaining = WRITE ? (await deptGoalCandidates(orgId)).length : todo.length;
  return { candidates: todo.length, written, remaining };
}

async function main() {
  line(`Phase 6 people backfills: ${WRITE ? "WRITE" : "DRY RUN"} · step=${STEP}${ORG ? ` · org=${ORG}` : ""} · ${new Date().toISOString()}`);
  if (!(await columnsPresent())) {
    line("The Phase 6 columns are absent (apply prisma/sql/2026-09-26-phase6-people.sql first). Nothing written.");
    return 0;
  }
  const ALL_STEPS = ["talent-source", "survey-creator", "cycle-creator", "dept-goal-assignees"];
  const steps = STEP === "all" ? ALL_STEPS : [STEP];
  for (const st of steps) {
    if (!ALL_STEPS.includes(st)) {
      line(`Unknown step "${st}".`);
      return 1;
    }
  }
  let failed = false;
  const totals: Record<string, number> = {};
  for (const org of await orgs()) {
    line("");
    line(`Organization ${org.name} (${org.id})`);
    if (steps.includes("talent-source")) {
      const r = await talentSource(org.id);
      line(`  talent-source        candidates ${r.candidates} · written ${r.written} · remaining ${r.remaining}`);
      totals.talent = (totals.talent ?? 0) + r.candidates;
      if (WRITE && (r.remaining !== 0 || r.written !== r.candidates)) { failed = true; line("  ASSERT FAILED: talent-source"); }
    }
    if (steps.includes("survey-creator")) {
      const r = await surveyCreator(org.id);
      line(`  survey-creator       without a creator ${r.candidates} · log found ${r.found} · written ${r.written} · no log, left null ${r.noLog}`);
      totals.survey = (totals.survey ?? 0) + r.found;
      if (WRITE && r.written !== r.found) { failed = true; line("  ASSERT FAILED: survey-creator"); }
    }
    if (steps.includes("cycle-creator")) {
      const r = await cycleCreator(org.id);
      line(`  cycle-creator        without a creator ${r.candidates} · log found ${r.found} · written ${r.written} · no log, left null ${r.noLog}`);
      totals.cycle = (totals.cycle ?? 0) + r.found;
      if (WRITE && r.written !== r.found) { failed = true; line("  ASSERT FAILED: cycle-creator"); }
    }
    if (steps.includes("dept-goal-assignees")) {
      const r = await deptGoalAssignees(org.id);
      line(`  dept-goal-assignees  candidates ${r.candidates} · written ${r.written} · remaining ${r.remaining}`);
      totals.dept = (totals.dept ?? 0) + r.candidates;
      if (WRITE && (r.remaining !== 0 || r.written !== r.candidates)) { failed = true; line("  ASSERT FAILED: dept-goal-assignees"); }
    }
  }
  line("");
  line(`Totals: ${Object.entries(totals).map(([k, v]) => `${k} ${v}`).join(" · ") || "nothing to do"}`);
  line(failed ? "RESULT: assertions FAILED" : WRITE ? "RESULT: written, assertions passed" : "RESULT: dry run, nothing written");
  return failed ? 1 : 0;
}

main()
  .then((code) => {
    if (REPORT) writeFileSync(REPORT, `${out.join("\n")}\n`);
    return prisma.$disconnect().then(() => process.exit(code));
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
