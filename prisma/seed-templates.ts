// The built-in template library.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/templates) and
// section 4 step 7. Run it with:
//
//   npx tsx prisma/seed-templates.ts            (report only, writes nothing)
//   npx tsx prisma/seed-templates.ts --write    (upsert)
//
// IDEMPOTENT BY KEY. Every row carries a stable `Template.key` and is upserted
// on it, so re-running never duplicates a card. An org's own saved templates
// carry a null key and are never matched, so nothing a customer wrote is ever
// touched by this file. Content is only overwritten on rows this seed owns
// (`builtIn: true` and `organizationId: null`); if a row with the key exists
// and is NOT built-in, the seed leaves it alone and says so.
//
// WHAT IS IN HERE, AND WHY IT IS NOT THREE ROWS. The spec says "the three
// Space-wizard presets become seeded Space templates". The wizard file
// (src/components/layout/os/space-wizard-presets.ts) actually carries EIGHT:
// starter, people-hr, engineering, marketing, operations, sales, support and
// customer-success. Seeding three would retire five destinations the moment
// that file is deleted, so all eight are here. The wizard file itself is not
// touched by this change: it is still the live create-Space path until the
// spaces-lists step 3 rebuild replaces it, and these rows are additive.
//
// Plus "Ideas board", the List template spec-work-home W5 needs before /ideas
// can be merged away. Its statuses and fields are fixed by the spec so the
// ideas migration has something defined to map onto.

import type { Prisma, PrismaClient } from "../src/generated/prisma";
import { scriptPrisma } from "../scripts/lib/script-prisma";

let client: PrismaClient | null = null;
/** Lazy, so importing SEED_TEMPLATES in a test never needs a database. */
function db(): PrismaClient {
  if (!client) client = scriptPrisma();
  return client;
}

type StatusRow = { value: string; label: string; color: string; group: "ACTIVE" | "DONE" | "CLOSED" };

const HUE = {
  slate: "#71717A",
  grey: "#6B7280",
  blue: "#0073EA",
  amber: "#F59E0B",
  orange: "#F97316",
  yellow: "#EAB308",
  cyan: "#06B6D4",
  mist: "#94A3B8",
  sky: "#3B82F6",
  green: "#10B981",
  stone: "#9CA3AF",
} as const;

/* ─────────────────── the eight Space presets ─────────────────── */

const STARTER: StatusRow[] = [
  { value: "TO_DO", label: "TO DO", color: HUE.slate, group: "ACTIVE" },
  { value: "IN_PROGRESS", label: "IN PROGRESS", color: HUE.blue, group: "ACTIVE" },
  { value: "COMPLETE", label: "COMPLETE", color: HUE.green, group: "DONE" },
];

const HR: StatusRow[] = [
  { value: "DRAFT", label: "DRAFT", color: HUE.mist, group: "ACTIVE" },
  { value: "ACTIVE", label: "ACTIVE", color: HUE.cyan, group: "ACTIVE" },
  { value: "COMPLETE", label: "COMPLETE", color: HUE.green, group: "DONE" },
];

const ENG: StatusRow[] = [
  { value: "TO_DO", label: "TO DO", color: HUE.slate, group: "ACTIVE" },
  { value: "IN_PROGRESS", label: "IN PROGRESS", color: HUE.blue, group: "ACTIVE" },
  { value: "IN_REVIEW", label: "IN REVIEW", color: HUE.amber, group: "ACTIVE" },
  { value: "DONE", label: "DONE", color: HUE.green, group: "DONE" },
];

const MARKETING: StatusRow[] = [
  { value: "PLANNED", label: "PLANNED", color: HUE.sky, group: "ACTIVE" },
  { value: "IN_PROGRESS", label: "IN PROGRESS", color: HUE.blue, group: "ACTIVE" },
  { value: "PUBLISHED", label: "PUBLISHED", color: HUE.green, group: "DONE" },
];

const OPS: StatusRow[] = [
  { value: "PLANNING", label: "PLANNING", color: HUE.grey, group: "ACTIVE" },
  { value: "IN_PROGRESS", label: "IN PROGRESS", color: HUE.blue, group: "ACTIVE" },
  { value: "AT_RISK", label: "AT RISK", color: HUE.orange, group: "ACTIVE" },
  { value: "COMPLETE", label: "COMPLETE", color: HUE.green, group: "DONE" },
  { value: "CANCELLED", label: "CANCELLED", color: HUE.stone, group: "CLOSED" },
];

const SALES: StatusRow[] = [
  { value: "PROSPECT", label: "PROSPECT", color: HUE.mist, group: "ACTIVE" },
  { value: "QUALIFIED", label: "QUALIFIED", color: HUE.cyan, group: "ACTIVE" },
  { value: "PROPOSAL", label: "PROPOSAL", color: HUE.blue, group: "ACTIVE" },
  { value: "NEGOTIATION", label: "NEGOTIATION", color: HUE.orange, group: "ACTIVE" },
  { value: "CLOSED_WON", label: "CLOSED WON", color: HUE.green, group: "DONE" },
  { value: "CLOSED_LOST", label: "CLOSED LOST", color: HUE.stone, group: "CLOSED" },
];

const SUPPORT: StatusRow[] = [
  { value: "OPEN", label: "OPEN", color: HUE.slate, group: "ACTIVE" },
  { value: "IN_PROGRESS", label: "IN PROGRESS", color: HUE.blue, group: "ACTIVE" },
  { value: "AWAITING_CUSTOMER", label: "AWAITING CUSTOMER", color: HUE.yellow, group: "ACTIVE" },
  { value: "RESOLVED", label: "RESOLVED", color: HUE.green, group: "DONE" },
  { value: "CLOSED", label: "CLOSED", color: HUE.stone, group: "CLOSED" },
];

const CS: StatusRow[] = [
  { value: "ONBOARDING", label: "ONBOARDING", color: HUE.mist, group: "ACTIVE" },
  { value: "ADOPTION", label: "ADOPTION", color: HUE.cyan, group: "ACTIVE" },
  { value: "HEALTHY", label: "HEALTHY", color: HUE.blue, group: "ACTIVE" },
  { value: "AT_RISK", label: "AT RISK", color: HUE.orange, group: "ACTIVE" },
  { value: "RENEWED", label: "RENEWED", color: HUE.green, group: "DONE" },
  { value: "EXPANSION", label: "EXPANSION", color: HUE.green, group: "DONE" },
  { value: "CHURNED", label: "CHURNED", color: HUE.stone, group: "CLOSED" },
];

/** The Ideas board statuses, fixed by spec-spaces-lists section 2. */
const IDEAS: StatusRow[] = [
  { value: "SUBMITTED", label: "Submitted", color: HUE.mist, group: "ACTIVE" },
  { value: "UNDER_REVIEW", label: "Under review", color: HUE.blue, group: "ACTIVE" },
  { value: "APPROVED", label: "Approved", color: HUE.cyan, group: "ACTIVE" },
  { value: "IMPLEMENTED", label: "Implemented", color: HUE.green, group: "DONE" },
  { value: "REWARDED", label: "Rewarded", color: HUE.green, group: "DONE" },
  { value: "REJECTED", label: "Rejected", color: HUE.stone, group: "CLOSED" },
];

interface SeedRow {
  key: string;
  kind: "TASK" | "LIST" | "SPACE" | "FOLDER" | "DOC" | "VIEW" | "WHITEBOARD";
  name: string;
  description: string;
  complexity: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  category: string;
  useCases: string[];
  tags: string[];
  payload: Prisma.InputJsonValue;
}

function spacePreset(args: {
  key: string;
  name: string;
  description: string;
  complexity: SeedRow["complexity"];
  statuses: StatusRow[];
  defaultView: "TABLE" | "KANBAN";
  lists: Array<{ name: string }>;
  icon: string;
  color: string;
}): SeedRow {
  return {
    key: args.key,
    kind: "SPACE",
    name: args.name,
    description: args.description,
    complexity: args.complexity,
    category: "Spaces",
    useCases: ["space-setup"],
    tags: ["built-in", "space"],
    payload: {
      icon: args.icon,
      color: args.color,
      workflow: { statuses: args.statuses, defaultView: args.defaultView },
      lists: args.lists.map((l) => ({
        name: l.name,
        statuses: args.statuses,
        defaultView: args.defaultView,
      })),
    } as Prisma.InputJsonValue,
  };
}

export const SEED_TEMPLATES: SeedRow[] = [
  spacePreset({
    key: "space.starter",
    name: "Starter",
    description: "A plain Space for everyday work: one list, three statuses, nothing to learn.",
    complexity: "BEGINNER",
    statuses: STARTER,
    defaultView: "TABLE",
    lists: [{ name: "Tasks" }],
    icon: "Boxes",
    color: HUE.slate,
  }),
  spacePreset({
    key: "space.people-hr",
    name: "People and HR",
    description: "Onboarding, reviews and kudos, with a draft-to-complete flow for people work.",
    complexity: "BEGINNER",
    statuses: HR,
    defaultView: "TABLE",
    lists: [{ name: "Onboarding" }, { name: "Reviews" }],
    icon: "Users",
    color: HUE.cyan,
  }),
  spacePreset({
    key: "space.engineering",
    name: "Engineering",
    description: "Board first, with an In review column between doing and done.",
    complexity: "INTERMEDIATE",
    statuses: ENG,
    defaultView: "KANBAN",
    lists: [{ name: "Backlog" }, { name: "Current sprint" }],
    icon: "GitBranch",
    color: HUE.blue,
  }),
  spacePreset({
    key: "space.marketing",
    name: "Marketing",
    description: "Campaigns and a content calendar, planned through to published.",
    complexity: "BEGINNER",
    statuses: MARKETING,
    defaultView: "KANBAN",
    lists: [{ name: "Campaigns" }, { name: "Content calendar" }],
    icon: "Megaphone",
    color: HUE.orange,
  }),
  spacePreset({
    key: "space.operations",
    name: "Operations",
    description: "Projects with an At risk status, so a slipping project says so before it is late.",
    complexity: "INTERMEDIATE",
    statuses: OPS,
    defaultView: "TABLE",
    lists: [{ name: "Projects" }, { name: "Requests" }],
    icon: "SlidersHorizontal",
    color: HUE.grey,
  }),
  spacePreset({
    key: "space.sales",
    name: "Sales",
    description: "A deal pipeline as a board: prospect through to closed won, with closed lost kept separate.",
    complexity: "INTERMEDIATE",
    statuses: SALES,
    defaultView: "KANBAN",
    lists: [{ name: "Pipeline" }],
    icon: "TrendingUp",
    color: HUE.green,
  }),
  spacePreset({
    key: "space.support",
    name: "Support",
    description: "A ticket queue with an Awaiting customer pause, so response time is not counted against you twice.",
    complexity: "INTERMEDIATE",
    statuses: SUPPORT,
    defaultView: "KANBAN",
    lists: [{ name: "Tickets" }],
    icon: "MessageSquare",
    color: HUE.amber,
  }),
  spacePreset({
    key: "space.customer-success",
    name: "Customer Success",
    description: "Account lifecycle rather than deal lifecycle: onboarding, adoption, renewal, and the churn signal.",
    complexity: "ADVANCED",
    statuses: CS,
    defaultView: "KANBAN",
    lists: [{ name: "Accounts" }, { name: "Renewals" }],
    icon: "Gauge",
    color: HUE.cyan,
  }),

  // The Ideas board, owed to spec-work-home W5.
  {
    key: "list.ideas-board",
    kind: "LIST",
    name: "Ideas board",
    description:
      "Collect suggestions from everyone, review them in the open, and show what happened to each one. Ideas move Submitted, Under review, Approved, then Implemented or Rejected.",
    complexity: "BEGINNER",
    category: "Lists",
    useCases: ["ideas", "suggestions"],
    tags: ["built-in", "list", "ideas"],
    payload: {
      icon: "Lightbulb",
      color: HUE.yellow,
      statuses: IDEAS,
      fields: [
        // Votes is a plain number until a rating-style upvote field exists;
        // Category lands as a select because the field catalog has one.
        { key: "votes", label: "Votes", type: "number", position: 0 },
        {
          key: "category",
          label: "Category",
          type: "select",
          position: 1,
          options: {
            choices: [
              { value: "product", label: "Product", color: HUE.blue },
              { value: "process", label: "Process", color: HUE.cyan },
              { value: "culture", label: "Culture", color: HUE.green },
              { value: "cost-cutting", label: "Cost-cutting", color: HUE.amber },
            ],
          },
        },
      ],
      defaultView: "KANBAN",
      views: [
        { type: "KANBAN", name: "Board", config: { groupBy: "status" } },
        { type: "TABLE", name: "List", config: { groupBy: "status" } },
      ],
    } as Prisma.InputJsonValue,
  },
];

/* ───────────────────────────── the run ───────────────────────────── */

/**
 * Key-order-independent JSON, so a second run reports "unchanged" rather than
 * "update": Postgres stores jsonb with its own key order, and a byte compare
 * against the literal in this file would rewrite all nine rows every time.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

interface SeedReport {
  created: string[];
  updated: string[];
  unchanged: string[];
  skippedNotBuiltIn: string[];
}

export async function seedTemplates(write: boolean): Promise<SeedReport> {
  const report: SeedReport = { created: [], updated: [], unchanged: [], skippedNotBuiltIn: [] };

  for (const row of SEED_TEMPLATES) {
    const existing = await db().template.findFirst({
      where: { key: row.key },
      select: { id: true, builtIn: true, organizationId: true, name: true, description: true, payload: true },
    });

    if (existing && (!existing.builtIn || existing.organizationId !== null)) {
      // Somebody adopted the key. Never overwrite a customer's row.
      report.skippedNotBuiltIn.push(row.key);
      continue;
    }

    const data = {
      key: row.key,
      kind: row.kind,
      name: row.name,
      description: row.description,
      complexity: row.complexity,
      category: row.category,
      useCases: row.useCases,
      tags: row.tags,
      builtIn: true,
      organizationId: null,
      payload: row.payload,
    };

    if (!existing) {
      report.created.push(row.key);
      if (write) await db().template.create({ data });
      continue;
    }

    const same =
      existing.name === row.name &&
      existing.description === row.description &&
      canonical(existing.payload) === canonical(row.payload);
    if (same) {
      report.unchanged.push(row.key);
      continue;
    }
    report.updated.push(row.key);
    if (write) await db().template.update({ where: { id: existing.id }, data });
  }

  return report;
}

async function main() {
  const write = process.argv.includes("--write");
  const report = await seedTemplates(write);
  const lines = [
    write ? "seed-templates: WRITE" : "seed-templates: DRY RUN (pass --write to apply)",
    `  create    ${report.created.length}${report.created.length ? `  ${report.created.join(", ")}` : ""}`,
    `  update    ${report.updated.length}${report.updated.length ? `  ${report.updated.join(", ")}` : ""}`,
    `  unchanged ${report.unchanged.length}`,
    `  skipped   ${report.skippedNotBuiltIn.length}${report.skippedNotBuiltIn.length ? `  (a non-built-in row owns the key: ${report.skippedNotBuiltIn.join(", ")})` : ""}`,
  ];
  console.log(lines.join("\n"));
}

// Only run when executed directly, so a test can import SEED_TEMPLATES.
if (process.argv[1] && process.argv[1].endsWith("seed-templates.ts")) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db().$disconnect());
}
