// Seed the built-in Template Center library — a small set of global,
// org-agnostic templates (organizationId = null, builtIn = true) that
// every workspace sees under "Featured".
//
// Idempotent: rows use deterministic ids and are upserted, so re-running
// updates payloads in place rather than duplicating.
//
// Usage: node scripts/seed-templates.mjs

import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
loadEnv();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const S = (value, label, color, group) => ({ value, label, color, group });

// Reusable status sets.
const BASIC = [
  S("TO_DO", "To Do", "#94a3b8", "ACTIVE"),
  S("IN_PROGRESS", "In Progress", "#3b82f6", "ACTIVE"),
  S("DONE", "Done", "#10b981", "DONE"),
];
const SPRINT = [
  S("BACKLOG", "Backlog", "#94a3b8", "ACTIVE"),
  S("TODO", "To Do", "#a78bfa", "ACTIVE"),
  S("IN_PROGRESS", "In Progress", "#3b82f6", "ACTIVE"),
  S("IN_REVIEW", "In Review", "#f59e0b", "ACTIVE"),
  S("DONE", "Done", "#10b981", "DONE"),
];
const PIPELINE = [
  S("LEAD", "Lead", "#94a3b8", "ACTIVE"),
  S("QUALIFIED", "Qualified", "#6366f1", "ACTIVE"),
  S("PROPOSAL", "Proposal", "#f59e0b", "ACTIVE"),
  S("NEGOTIATION", "Negotiation", "#8b5cf6", "ACTIVE"),
  S("WON", "Won", "#10b981", "DONE"),
  S("LOST", "Lost", "#ef4444", "CLOSED"),
];

const views = (...types) => types.map((type) => ({ type }));

const TEMPLATES = [
  {
    id: "tpl_builtin_project_tracker",
    kind: "LIST",
    name: "Project Tracker",
    description: "A simple task list with To Do / In Progress / Done and List, Board, and Calendar views — the everyday starting point.",
    complexity: "BEGINNER",
    category: "Project Management",
    useCases: ["Projects", "Task tracking"],
    tags: ["tasks", "kanban", "starter"],
    payload: {
      statuses: BASIC,
      defaultView: "TABLE",
      views: views("TABLE", "KANBAN", "CALENDAR"),
      items: [
        { title: "Define project scope", status: "TO_DO" },
        { title: "Kick-off meeting", status: "TO_DO" },
      ],
    },
  },
  {
    id: "tpl_builtin_sprint_board",
    kind: "LIST",
    name: "Agile Sprint Board",
    description: "Backlog → In Review → Done with Board, List, and Gantt views for software teams running sprints.",
    complexity: "INTERMEDIATE",
    category: "Software Development",
    useCases: ["Sprints", "Engineering"],
    tags: ["agile", "scrum", "dev"],
    payload: {
      statuses: SPRINT,
      defaultView: "KANBAN",
      views: views("KANBAN", "TABLE", "GANTT"),
      items: [
        { title: "Set up repository", status: "TODO" },
        { title: "Write API spec", status: "BACKLOG" },
      ],
    },
  },
  {
    id: "tpl_builtin_content_calendar",
    kind: "LIST",
    name: "Content Calendar",
    description: "Plan, draft, and publish content with a Calendar-first view and an editorial status flow.",
    complexity: "BEGINNER",
    category: "Marketing",
    useCases: ["Content", "Editorial"],
    tags: ["marketing", "calendar", "content"],
    payload: {
      statuses: [
        S("IDEA", "Idea", "#94a3b8", "ACTIVE"),
        S("DRAFTING", "Drafting", "#3b82f6", "ACTIVE"),
        S("REVIEW", "Review", "#f59e0b", "ACTIVE"),
        S("SCHEDULED", "Scheduled", "#8b5cf6", "ACTIVE"),
        S("PUBLISHED", "Published", "#10b981", "DONE"),
      ],
      defaultView: "CALENDAR",
      views: views("CALENDAR", "TABLE", "KANBAN"),
    },
  },
  {
    id: "tpl_builtin_sales_space",
    kind: "SPACE",
    name: "Sales Pipeline",
    description: "A ready-made Sales Space with a deal pipeline List (Lead → Won/Lost) and a follow-up task list.",
    complexity: "INTERMEDIATE",
    category: "Sales",
    useCases: ["CRM", "Deals", "Sales"],
    tags: ["sales", "pipeline", "crm"],
    payload: {
      color: "#6366f1",
      workflow: { statuses: PIPELINE, defaultView: "KANBAN" },
      lists: [
        {
          name: "Deals",
          statuses: PIPELINE,
          defaultView: "KANBAN",
          views: views("KANBAN", "TABLE"),
        },
        {
          name: "Follow-ups",
          statuses: BASIC,
          defaultView: "TABLE",
          views: views("TABLE", "CALENDAR"),
        },
      ],
    },
  },
  {
    id: "tpl_builtin_team_ops_space",
    kind: "SPACE",
    name: "Team Operations",
    description: "An operations Space with a project tracker and a meetings/action-items List to run a team.",
    complexity: "BEGINNER",
    category: "Operations",
    useCases: ["Team", "Operations"],
    tags: ["ops", "team", "starter"],
    payload: {
      color: "#0ea5e9",
      workflow: { statuses: BASIC, defaultView: "TABLE" },
      lists: [
        { name: "Projects", statuses: BASIC, defaultView: "TABLE", views: views("TABLE", "KANBAN", "GANTT") },
        { name: "Action Items", statuses: BASIC, defaultView: "TABLE", views: views("TABLE") },
      ],
    },
  },
];

async function main() {
  let created = 0;
  let updated = 0;
  for (const t of TEMPLATES) {
    const existing = await prisma.template.findUnique({ where: { id: t.id }, select: { id: true } });
    const data = {
      kind: t.kind,
      name: t.name,
      description: t.description,
      complexity: t.complexity ?? null,
      category: t.category ?? null,
      useCases: t.useCases ?? [],
      tags: t.tags ?? [],
      builtIn: true,
      organizationId: null,
      payload: t.payload,
    };
    await prisma.template.upsert({
      where: { id: t.id },
      create: { id: t.id, ...data },
      update: data,
    });
    if (existing) updated++; else created++;
    console.log(`  ${existing ? "updated" : "created"}  ${t.kind.padEnd(5)}  ${t.name}`);
  }
  console.log(`\nSeed complete — ${created} created, ${updated} updated, ${TEMPLATES.length} total built-in templates.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
