// GET /api/automation/templates
//
// The starter-recipe gallery. AutomationTemplate rows are global
// (org-independent): the seed recipes below are created lazily when any
// org loads the gallery and a fixed seed id is missing (fixed ids +
// skipDuplicates make the seeding idempotent under races; a stored row is
// never rewritten).
//
// "Use template" is client-side: the gallery clones templateJson
// ({ triggerEvent, definition }) into POST /api/automation/workflows,
// which creates a DRAFT the builder then opens.

import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { requireAutomation } from "@/lib/automation/gate";
import { isLegacyTrigger, legacyTriggersEnabled } from "@/lib/automation/registry-triggers";

const SEEDS: Prisma.AutomationTemplateCreateManyInput[] = [
  {
    id: "tpl-task-created-notify-assignee",
    name: "When a task is created, notify the assignee",
    description: "Drops an Inbox notification to whoever the new task is assigned to, so nothing lands silently.",
    category: "Tasks",
    severity: "MINOR",
    templateJson: {
      triggerEvent: "task.created",
      definition: {
        conditions: { logic: "AND", rules: [{ field: "ownerId", operator: "is_not_empty" }] },
        actions: [
          {
            key: "create_notification",
            name: "Send an in-app notification",
            params: {
              userId: "assignee",
              title: "New task assigned to you",
              message: 'You were assigned "{{title}}".',
            },
          },
        ],
      },
    },
  },
  {
    id: "tpl-task-done-notify-board-owner",
    name: "When a task's status changes to Done, notify the List owner",
    description: "Tells the List's owner the moment work is marked Done.",
    category: "Tasks",
    severity: "MINOR",
    templateJson: {
      triggerEvent: "task.status_changed",
      definition: {
        conditions: { logic: "AND", rules: [{ field: "status", operator: "eq", value: "DONE" }] },
        actions: [
          {
            key: "create_notification",
            name: "Send an in-app notification",
            params: {
              userId: "board_owner",
              title: "Task completed",
              message: '"{{title}}" was marked {{status}}.',
            },
          },
        ],
      },
    },
  },
  {
    id: "tpl-task-unassigned-assign-board-owner",
    name: "When a task is created without an assignee, assign the List owner",
    description: "No task sits ownerless: anything created unassigned goes straight to the List's owner.",
    category: "Tasks",
    severity: "MAJOR",
    templateJson: {
      triggerEvent: "task.created",
      definition: {
        conditions: { logic: "AND", rules: [{ field: "ownerId", operator: "is_empty" }] },
        actions: [
          {
            key: "assign_user",
            name: "Assign a person",
            params: { userId: "board_owner" },
          },
        ],
      },
    },
  },
  {
    id: "tpl-due-tomorrow-remind-assignee",
    name: "A day before a task is due, remind the assignee",
    description: "The assignee gets an Inbox notification the day before the due date, so nothing is a surprise.",
    category: "Time",
    severity: "MINOR",
    templateJson: {
      triggerEvent: "task.date_arrives",
      definition: {
        when: { dateField: "dueAt", offsetDays: -1 },
        conditions: { logic: "AND", rules: [{ field: "ownerId", operator: "is_not_empty" }] },
        actions: [
          {
            key: "create_notification",
            name: "Send an in-app notification",
            params: {
              userId: "assignee",
              title: "Due tomorrow",
              message: '"{{title}}" is due tomorrow.',
            },
          },
        ],
      },
    },
  },
  {
    id: "tpl-priority-urgent-notify-list-owner",
    name: "When a task becomes Urgent, tell the List owner and comment on it",
    description: "The List's owner hears about it at once, and the task says who was told, in two steps.",
    category: "Tasks",
    severity: "MAJOR",
    templateJson: {
      triggerEvent: "task.field_changed",
      definition: {
        when: { field: "priority" },
        conditions: { logic: "AND", rules: [{ field: "priority", operator: "eq", value: "URGENT" }] },
        actions: [
          {
            key: "create_notification",
            name: "Send an in-app notification",
            params: {
              userId: "board_owner",
              title: "A task became urgent",
              message: '"{{title}}" was marked Urgent.',
            },
          },
          {
            key: "add_comment",
            name: "Add a comment",
            params: { body: "Marked Urgent. The List owner has been told." },
          },
        ],
      },
    },
  },
  {
    id: "tpl-lead-created-follow-up-task",
    name: "When a lead is created, create a follow-up task",
    description: "Creates a high-priority follow-up task due tomorrow on a board you pick in the builder.",
    category: "Leads",
    severity: "MAJOR",
    templateJson: {
      triggerEvent: "lead.created",
      definition: {
        conditions: null,
        actions: [
          {
            key: "create_task",
            name: "Create a task",
            params: {
              boardId: "",
              title: "Follow up with new lead {{id}}",
              priority: "HIGH",
              dueInDays: 1,
            },
          },
        ],
      },
    },
  },
  {
    id: "tpl-kpi-recorded-notify-admins",
    name: "When a KPI is recorded, notify the org admins",
    description: "Every workspace admin gets an Inbox notification each time a KPI actual lands.",
    category: "Performance",
    severity: "MINOR",
    templateJson: {
      triggerEvent: "kpi.recorded",
      definition: {
        conditions: null,
        actions: [
          {
            key: "create_notification",
            name: "Send an in-app notification",
            params: {
              userId: "admins",
              title: "KPI recorded",
              message: "A KPI reading was recorded for {{period}}: actual {{actualValue}} vs target {{targetValue}}.",
            },
          },
        ],
      },
    },
  },
];

export async function GET() {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;

  // Create-if-empty seeding. Fixed ids + skipDuplicates keep concurrent
  // first-loads from double-inserting; a failed seed never blocks the
  // gallery read below.
  try {
    // A seed added in a later release reaches a table that was seeded
    // before it: insert whichever fixed ids are missing (never rewrite one).
    const have = await prisma.automationTemplate.findMany({
      where: { id: { in: SEEDS.map((t) => t.id as string) } },
      select: { id: true },
    });
    if (have.length < SEEDS.length) {
      const present = new Set(have.map((r) => r.id));
      // The Cashkr-era Leads recipe is never inserted fresh; a row that
      // already exists stays, behind the legacy-triggers flag.
      const missing = SEEDS.filter((t) => !present.has(t.id as string) && !isLegacyTrigger(String((t.templateJson as { triggerEvent?: string }).triggerEvent ?? "")));
      if (missing.length) await prisma.automationTemplate.createMany({ data: missing, skipDuplicates: true });
    }
  } catch {
    // Non-fatal: the gallery just renders whatever rows exist.
  }

  const templates = await prisma.automationTemplate.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      severity: true,
      templateJson: true,
      createdAt: true,
    },
  });

  // A recipe on a trigger hidden behind the legacy product flag (the
  // Cashkr-era Leads recipe) is not offered while the flag is off. The row
  // stays in the table, untouched, and comes back with the flag.
  const org = await prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { settings: true } });
  const showLegacy = legacyTriggersEnabled(org?.settings);
  const offered = showLegacy
    ? templates
    : templates.filter((t) => {
        const trigger = (t.templateJson as { trigger?: { event?: string }; triggerEvent?: string } | null);
        const key = trigger?.trigger?.event ?? trigger?.triggerEvent ?? "";
        return !isLegacyTrigger(key);
      });

  // A seed row keeps the copy it was first inserted with (skipDuplicates
  // never rewrites it), so an older row can carry wording since corrected
  // here. The gallery serves the current copy for the fixed seed ids; the
  // stored row is left untouched.
  const seedCopy = new Map(SEEDS.map((t) => [t.id, t]));
  const served = offered.map((t) => {
    const seed = seedCopy.get(t.id);
    return seed ? { ...t, name: seed.name, description: seed.description ?? t.description } : t;
  });

  return NextResponse.json({ templates: served });
}
