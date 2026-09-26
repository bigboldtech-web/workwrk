// GET /api/automation/templates
//
// The starter-recipe gallery. AutomationTemplate rows are global
// (org-independent): the 5 seed recipes below are created lazily the
// first time any org loads the gallery (create-if-empty; fixed ids +
// skipDuplicates make the seeding idempotent under races).
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
    name: "When a task's status changes to Done, notify the board owner",
    description: "Tells the board's owner the moment work is marked Done.",
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
    name: "When a task is created without an assignee, assign the board owner",
    description: "No task sits ownerless: anything created unassigned goes straight to the board's owner.",
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
    const count = await prisma.automationTemplate.count();
    if (count === 0) {
      await prisma.automationTemplate.createMany({ data: SEEDS, skipDuplicates: true });
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
