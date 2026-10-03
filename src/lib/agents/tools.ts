// Agent tool registry, Phase D3.
//
// Each tool is exposed to Claude via the Anthropic tool calling
// interface. When Claude wants to use a tool, the chat endpoint
// executes the handler and feeds the result back. Tools always run
// scoped to the calling user's org, no cross-org reads or writes.
//
// Tool selection for a chat:
//   - General Sidekick session (no agent) → CROSS_TOOLS (5 tools)
//   - Agent-scoped session → CROSS_TOOLS ∪ the agent's catalog.tools
//
// We DON'T expose every WorkwrK model as a tool, only the high-value
// "create + look up" surface the user would actually delegate. Power
// users can drop to the UI for everything else.

import { prisma } from "@/lib/prisma";
import { addressHref } from "@/lib/nav/object-href";
import { nodeCtxForUser, nodeRoles } from "@/lib/access/node-access";
import { refKey, roleAtLeast, type NodeRef } from "@/lib/access/node-rules";
import { createPersonalTask } from "@/lib/work/personal-task";
import { isDoneStatusName } from "@/lib/board-items-shared";
import { listReader, readableItemsVia } from "@/lib/list-links-server";
import { clampLimit, collectReadable, olderThan } from "./collect-readable";
import type { ToolName } from "./tool-names";
import { hasPermission, isOrgAdmin } from "@/lib/api-helpers";
import { sopVisibilityWhere } from "@/lib/sop-access";
import { legacyIsManagerLevel } from "@/lib/access/legacy-levels";
import { resolveInviteLevel } from "@/lib/access/invite-level";
import { goalVisibilityOr } from "@/lib/goal-audience";
import { goalRightsActor } from "@/lib/alignment-scope";
import { mayEditGoal } from "@/lib/goals/goal-rights";
import { persistGoalRollupChain } from "@/lib/alignment";
import { logActivity } from "@/lib/activity";
import { notifyGoalAssigned } from "@/lib/goals/goal-notify";

export interface ToolContext {
  orgId: string;
  userId: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema for the input, what Anthropic SDK calls input_schema.
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  // Handler receives the validated input and returns a JSON-serializable
  // result. Throw to indicate an error; the chat loop catches + sends
  // the error string back to Claude so it can react.
  handler: (ctx: ToolContext, input: Record<string, unknown>) => Promise<unknown>;
}

// ─────────────────────────────────────────────────────────
// The caller, for the handlers that must act as the person and no further.
// A chat runs as the signed-in person (access section 2.5), so a tool may
// never read or write past what that person could do in the UI.
// ─────────────────────────────────────────────────────────

async function callerLevel(ctx: ToolContext): Promise<string | null> {
  const row = await prisma.user.findFirst({
    where: { id: ctx.userId, organizationId: ctx.orgId },
    select: { accessLevel: true },
  });
  return row?.accessLevel ?? null;
}

/** The caller shaped like a session, for the shared goal rules (canSeeGoal,
 *  goalRightsActor), so a goal tool reads and writes exactly as the person
 *  could on the Goals pages. Null when the person is not in this org. */
async function callerSession(ctx: ToolContext): Promise<{ user: { id: string; organizationId: string; accessLevel: string } } | null> {
  const level = await callerLevel(ctx);
  return level ? { user: { id: ctx.userId, organizationId: ctx.orgId, accessLevel: level } } : null;
}

// ─────────────────────────────────────────────────────────
// Cross-product tools (available to every chat session)
// ─────────────────────────────────────────────────────────

const createTask: ToolDefinition = {
  name: "create_task",
  description:
    "Create a new task in WorkwrK Work. Use this when the user asks you to follow up, schedule, or capture a to-do. The task is assigned to the current user by default unless an assignee email is specified.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short, actionable title (e.g. 'Follow up with Acme Corp')" },
      description: { type: "string", description: "Optional details, links, context" },
      priority: {
        type: "string",
        enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
        description: "Defaults to NORMAL",
      },
      dueIsoDate: {
        type: "string",
        description: "Optional ISO 8601 date the task is due (YYYY-MM-DD or full datetime). Defaults to today.",
      },
      assigneeEmail: {
        type: "string",
        description: "Optional. If specified, find a user in this org by email and assign to them. Otherwise assigns to the caller.",
      },
    },
    required: ["title"],
  },
  handler: async (ctx, input) => {
    let assigneeId = ctx.userId;
    if (input.assigneeEmail) {
      const user = await prisma.user.findFirst({
        where: { email: input.assigneeEmail as string, organizationId: ctx.orgId },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!user) {
        return { error: `No user with email '${input.assigneeEmail}' in this organization. Task not created.` };
      }
      assigneeId = user.id;
    }

    const date = input.dueIsoDate ? new Date(input.dueIsoDate as string) : new Date();
    const priorityMap: Record<string, "LOW" | "NORMAL" | "HIGH" | "URGENT"> = {
      LOW: "LOW", NORMAL: "NORMAL", HIGH: "HIGH", URGENT: "URGENT",
    };
    // Phase 2 W4. This wrote the legacy `Task` table, whose UI is deleted in
    // this release, so the agent reported creating a task the person could
    // never open. It lands on the assignee's Personal list now, which is what
    // /my-work reads and what search_tasks below lists.
    const created = await createPersonalTask({
      organizationId: ctx.orgId,
      assigneeId,
      title: input.title as string,
      description: (input.description as string) ?? null,
      priority: priorityMap[input.priority as string] ?? "NORMAL",
      dueAt: date,
      actorId: ctx.userId,
    });
    const task = {
      id: created.id,
      title: created.title,
      priority: created.priority,
      date: created.dueAt,
      assigneeId: created.assigneeId,
    };
    return { ok: true, task };
  },
};

const searchTasks: ToolDefinition = {
  name: "search_tasks",
  description:
    "List tasks in WorkwrK Work, optionally filtered. Use this to answer 'what's on my plate' or to find a task before updating it.",
  input_schema: {
    type: "object",
    properties: {
      // A status on an Item is a per-List NAME ("To Do", "Shipped"), not one
      // of three enum values, so this is a free-text match rather than an
      // enum. `done: true` is the question people actually ask.
      status: {
        type: "string",
        description: "Filter to a single status name, as it appears on the List (e.g. 'To Do', 'In Progress')",
      },
      done: { type: "boolean", description: "true = only finished tasks, false = only unfinished" },
      assignedToMe: { type: "boolean", description: "Only my tasks" },
      titleContains: { type: "string", description: "Case-insensitive substring match" },
      limit: { type: "integer", description: "Max rows (default 20, max 50)" },
    },
  },
  // Phase 2 W4. This listed the legacy `Task` table, so it could not see a
  // single task the product has shown anybody since the migration, including
  // the ones create_task above had just written.
  handler: async (ctx, input) => {
    const limit = clampLimit(input.limit, 20, 50);
    // Only the tasks the caller could open, by the task page's own ladder
    // (readableItemsVia: an org admin, the home List, the owner or an
    // assignee, the creator, a linked List). The candidates are read in
    // pages until `limit` readable ones are found (collectReadable): one
    // over-fetched batch filtered afterwards could leave a narrow reader in a
    // big workspace with nothing while readable tasks existed further down.
    // A denied or departed person reads nothing; the level is read fresh.
    const nodeCtx = await nodeCtxForUser(ctx.userId, ctx.orgId);
    if (nodeCtx.denied) return { count: 0, tasks: [] };
    const level = await callerLevel(ctx);
    if (!level) return { count: 0, tasks: [] };
    const viewer = { userId: ctx.userId, organizationId: ctx.orgId, accessLevel: level };
    const reader = listReader(viewer);
    const page = (after: { id: string; updatedAt: Date } | null, take: number) => prisma.item.findMany({
        where: {
          organizationId: ctx.orgId,
          archivedAt: null,
          ...(input.status ? { status: { equals: input.status as string, mode: "insensitive" } } : {}),
          ...(input.assignedToMe
            ? { OR: [{ ownerId: ctx.userId }, { assigneeIds: { has: ctx.userId } }] }
            : {}),
          ...(input.titleContains ? { title: { contains: input.titleContains as string, mode: "insensitive" } } : {}),
          AND: [olderThan(after)],
        },
        select: { id: true, title: true, status: true, priority: true, dueAt: true, ownerId: true, boardId: true, assigneeIds: true, organizationId: true, parentItemId: true, updatedAt: true },
        // A stable order (updatedAt, then id), paged by keyset, so the pages neither skip nor repeat.
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take,
      });
    const { rows: filtered, capped, scanned } = await collectReadable({
      limit,
      batch: Math.min(200, Math.max(limit * 4, 50)),
      maxScan: 1000,
      page,
      // "done" is a status-name rule, not a column, so it is applied here.
      keep: async (batch: Awaited<ReturnType<typeof page>>) => {
        const access = await readableItemsVia(viewer, batch, reader);
        return batch.filter((r) => access.get(r.id)?.readable && (input.done === undefined || isDoneStatusName(r.status) === Boolean(input.done)));
      },
    });
    const tasks = filtered.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      date: r.dueAt,
      assigneeId: r.ownerId,
    }));
    return {
      count: tasks.length,
      tasks,
      ...(capped ? { partial: true, searched: scanned, note: "Only the 1,000 most recently updated tasks were searched. Add a title or a status to narrow the search." } : {}),
    };
  },
};

const sendKudos: ToolDefinition = {
  name: "send_kudos",
  description:
    "Send a kudos message (public recognition) to a teammate. Use this when the user wants to celebrate someone's contribution.",
  input_schema: {
    type: "object",
    properties: {
      receiverEmail: { type: "string", description: "Email of the person being recognized" },
      message: { type: "string", description: "The recognition message" },
      companyValue: { type: "string", description: "Optional company value being celebrated (e.g. 'Customer First')" },
    },
    required: ["receiverEmail", "message"],
  },
  handler: async (ctx, input) => {
    const receiver = await prisma.user.findFirst({
      where: { email: input.receiverEmail as string, organizationId: ctx.orgId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!receiver) return { error: `No user with email '${input.receiverEmail}' in this organization.` };

    const kudos = await prisma.kudos.create({
      data: {
        organizationId: ctx.orgId,
        giverId: ctx.userId,
        receiverId: receiver.id,
        message: input.message as string,
        companyValue: (input.companyValue as string) ?? null,
      },
      select: { id: true, message: true, companyValue: true },
    });
    return { ok: true, kudos, receiver: `${receiver.firstName ?? ""} ${receiver.lastName ?? ""}`.trim() };
  },
};

// ─────────────────────────────────────────────────────────
// Legal (Leila's tool)
// ─────────────────────────────────────────────────────────

const createContract: ToolDefinition = {
  name: "create_contract",
  description: "Track a new contract in WorkwrK Legal. Use when the user mentions a contract being negotiated or signed.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      counterparty: { type: "string", description: "The other party's name" },
      type: { type: "string", description: "MSA | NDA | SOW | DPA | Order Form | ..." },
      counterpartyType: { type: "string", description: "Customer | Vendor | Partner | Investor | Employee" },
      value: { type: "number", description: "Contract value in USD" },
      expiresAt: { type: "string", description: "ISO date when the contract expires" },
    },
    required: ["title", "counterparty"],
  },
  handler: async (ctx, input) => {
    const contract = await prisma.contract.create({
      data: {
        organizationId: ctx.orgId,
        title: input.title as string,
        counterparty: input.counterparty as string,
        type: (input.type as string) ?? null,
        counterpartyType: (input.counterpartyType as string) ?? null,
        value: input.value as number | undefined,
        currency: "USD",
        expiresAt: input.expiresAt ? new Date(input.expiresAt as string) : null,
        ownerId: ctx.userId,
      },
      select: { id: true, title: true, counterparty: true, status: true },
    });
    return { ok: true, contract };
  },
};

// ─────────────────────────────────────────────────────────
// Dev (Dev's tool)
// ─────────────────────────────────────────────────────────

const createSprint: ToolDefinition = {
  name: "create_sprint",
  description: "Plan a new engineering sprint in WorkwrK Dev. Use when the user wants to capture a sprint goal + dates.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "e.g. 'Sprint 24' or 'Q1 W3'" },
      goal: { type: "string", description: "Single sprint goal, what success looks like" },
      startDate: { type: "string", description: "ISO date" },
      endDate: { type: "string", description: "ISO date" },
      capacityPoints: { type: "integer", description: "Team capacity in story points" },
    },
    required: ["name", "startDate", "endDate"],
  },
  handler: async (ctx, input) => {
    const sprint = await prisma.sprint.create({
      data: {
        organizationId: ctx.orgId,
        name: input.name as string,
        goal: (input.goal as string) ?? null,
        startDate: new Date(input.startDate as string),
        endDate: new Date(input.endDate as string),
        capacityPoints: input.capacityPoints as number | undefined,
      },
      select: { id: true, name: true, startDate: true, endDate: true, status: true },
    });
    return { ok: true, sprint };
  },
};

// ─────────────────────────────────────────────────────────
// Legal read tools
// ─────────────────────────────────────────────────────────

const searchContracts: ToolDefinition = {
  name: "search_contracts",
  description: "Search the contract portfolio. Use to find a contract by counterparty or to flag what's expiring soon.",
  input_schema: {
    type: "object",
    properties: {
      counterpartyContains: { type: "string" },
      status: { type: "string", enum: ["DRAFT", "IN_REVIEW", "IN_NEGOTIATION", "AWAITING_SIGNATURE", "SIGNED", "ACTIVE", "EXPIRED", "RENEWED", "TERMINATED", "CANCELLED"] },
      expiringWithinDays: { type: "integer", description: "Only contracts expiring within N days" },
      limit: { type: "integer" },
    },
  },
  handler: async (ctx, input) => {
    const limit = Math.min(50, Number(input.limit ?? 20));
    const expWindow = input.expiringWithinDays as number | undefined;
    const expiresBefore = expWindow != null ? new Date(Date.now() + expWindow * 86400000) : null;

    const contracts = await prisma.contract.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(input.counterpartyContains ? { counterparty: { contains: input.counterpartyContains as string, mode: "insensitive" } } : {}),
        ...(input.status ? { status: input.status as "DRAFT" | "IN_REVIEW" | "IN_NEGOTIATION" | "AWAITING_SIGNATURE" | "SIGNED" | "ACTIVE" | "EXPIRED" | "RENEWED" | "TERMINATED" | "CANCELLED" } : {}),
        ...(expiresBefore ? { expiresAt: { lte: expiresBefore, gte: new Date() } } : {}),
      },
      select: { id: true, title: true, counterparty: true, type: true, status: true, value: true, expiresAt: true, autoRenew: true },
      orderBy: { expiresAt: "asc" },
      take: limit,
    });
    return { count: contracts.length, contracts };
  },
};

// ─────────────────────────────────────────────────────────
// Cross-product search
// ─────────────────────────────────────────────────────────

const searchEmployees: ToolDefinition = {
  name: "search_employees",
  description: "Search this org's employees by name / email / role / department. Use to find a teammate to assign work to or to look up a coworker.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Matches firstName, lastName, email (case-insensitive substring)" },
      department: { type: "string", description: "Department name filter" },
      limit: { type: "integer" },
    },
  },
  handler: async (ctx, input) => {
    const limit = Math.min(30, Number(input.limit ?? 10));
    const q = input.query as string | undefined;
    const employees = await prisma.user.findMany({
      where: {
        organizationId: ctx.orgId,
        status: "ACTIVE",
        ...(input.department ? { department: { name: { equals: input.department as string, mode: "insensitive" } } } : {}),
        ...(q ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        } : {}),
      },
      select: {
        id: true, firstName: true, lastName: true, email: true, accessLevel: true,
        department: { select: { name: true } },
        role: { select: { title: true } },
      },
      orderBy: [{ firstName: "asc" }],
      take: limit,
    });
    return {
      count: employees.length,
      employees: employees.map((e) => ({
        id: e.id,
        name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
        email: e.email,
        department: e.department?.name ?? null,
        role: e.role?.title ?? null,
        accessLevel: e.accessLevel,
      })),
    };
  },
};

// ─────────────────────────────────────────────────────────
// Meetings (cross-product read)
// ─────────────────────────────────────────────────────────

const searchMeetings: ToolDefinition = {
  name: "search_meetings",
  description:
    "Search meetings on the org's calendar. Use to answer 'what's on my schedule', 'find my last 1:1 with Priya', or to pull up recent decisions/action items context.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["DAILY_STANDUP", "WEEKLY_REVIEW", "ONE_ON_ONE", "QUARTERLY_REVIEW", "ANNUAL_PLANNING", "ADHOC"],
      },
      titleContains: { type: "string" },
      attendedByMe: { type: "boolean", description: "Only meetings the caller is invited to / attended" },
      upcoming: { type: "boolean", description: "Only meetings scheduled in the future" },
      withinDays: { type: "integer", description: "Window in days (past or future depending on `upcoming`)" },
      limit: { type: "integer", description: "Max rows (default 20, max 50)" },
    },
  },
  handler: async (ctx, input) => {
    // Only meetings the person could open on the meeting page (meetingRole:
    // its creator, an attendee or an org admin), never a deleted one. This
    // returned every meeting in the workspace, other people's one to ones
    // with their agenda and attendees included. The level is read fresh.
    const session = await callerSession(ctx);
    if (!session) return { count: 0, meetings: [] };
    const admin = isOrgAdmin(session);
    const limit = Math.min(50, Number(input.limit ?? 20));
    const now = new Date();
    const windowMs = input.withinDays ? Number(input.withinDays) * 86400000 : null;

    const dateRange: { gte?: Date; lte?: Date } = {};
    if (input.upcoming) {
      dateRange.gte = now;
      if (windowMs) dateRange.lte = new Date(now.getTime() + windowMs);
    } else if (windowMs) {
      dateRange.gte = new Date(now.getTime() - windowMs);
      dateRange.lte = now;
    }

    const meetings = await prisma.meeting.findMany({
      where: {
        organizationId: ctx.orgId,
        deletedAt: null,
        ...(admin ? {} : { OR: [{ createdById: ctx.userId }, { attendees: { some: { userId: ctx.userId } } }] }),
        ...(input.type ? { type: input.type as "DAILY_STANDUP" | "WEEKLY_REVIEW" | "ONE_ON_ONE" | "QUARTERLY_REVIEW" | "ANNUAL_PLANNING" | "ADHOC" } : {}),
        ...(input.titleContains ? { title: { contains: input.titleContains as string, mode: "insensitive" } } : {}),
        ...(input.attendedByMe ? { attendees: { some: { userId: ctx.userId } } } : {}),
        ...(Object.keys(dateRange).length ? { scheduledAt: dateRange } : {}),
      },
      select: {
        id: true, title: true, type: true, scheduledAt: true, duration: true, agenda: true,
        attendees: { select: { user: { select: { firstName: true, lastName: true, email: true } }, attended: true } },
      },
      orderBy: input.upcoming ? { scheduledAt: "asc" } : { scheduledAt: "desc" },
      take: limit,
    });
    return {
      count: meetings.length,
      meetings: meetings.map((m) => ({
        id: m.id, title: m.title, type: m.type, scheduledAt: m.scheduledAt, durationMin: m.duration,
        agenda: m.agenda,
        attendees: m.attendees.map((a) => `${a.user.firstName ?? ""} ${a.user.lastName ?? ""}`.trim() || a.user.email).filter(Boolean),
      })),
    };
  },
};

// ─────────────────────────────────────────────────────────
// OKRs (read)
// ─────────────────────────────────────────────────────────

// OKR.level is the GoalLevel enum since the goals rebuild. The model
// may still emit legacy "TEAM", map it to DEPARTMENT and anything
// unrecognised to INDIVIDUAL, mirroring the migration's mapping.
function toGoalLevel(v: unknown): "COMPANY" | "DEPARTMENT" | "INDIVIDUAL" {
  if (v === "TEAM") return "DEPARTMENT";
  return v === "COMPANY" || v === "DEPARTMENT" || v === "INDIVIDUAL" ? v : "INDIVIDUAL";
}

const searchOkrs: ToolDefinition = {
  name: "search_okrs",
  description:
    "Search the org's OKRs (Objectives + Key Results). Use to find a specific objective, list a person's quarterly OKRs, or surface OKRs that are at risk.",
  input_schema: {
    type: "object",
    properties: {
      level: { type: "string", enum: ["COMPANY", "DEPARTMENT", "INDIVIDUAL"] },
      status: { type: "string", enum: ["ON_TRACK", "AT_RISK", "BEHIND", "COMPLETED"] },
      quarter: { type: "string", description: "e.g. 'Q2 2026'" },
      ownedByMe: { type: "boolean", description: "Only OKRs owned by the caller" },
      titleContains: { type: "string" },
      limit: { type: "integer" },
    },
  },
  handler: async (ctx, input) => {
    const limit = Math.min(50, Number(input.limit ?? 20));
    const session = await callerSession(ctx);
    if (!session) return { count: 0, okrs: [] };
    // Only goals the person could open on the Goals pages: an Individual goal
    // is not org public, and asking the assistant must never be a way round
    // that. The Goals list's own visibility rule, in the query, so nothing
    // visible is missed and nothing hidden is read.
    const visible = await goalVisibilityOr(session);
    const okrs = await prisma.oKR.findMany({
      where: {
        organizationId: ctx.orgId,
        ...(visible ? { AND: [{ OR: visible }] } : {}),
        ...(input.level ? { level: toGoalLevel(input.level) } : {}),
        ...(input.status ? { status: input.status as string } : {}),
        ...(input.quarter ? { quarter: input.quarter as string } : {}),
        ...(input.ownedByMe ? { ownerId: ctx.userId } : {}),
        ...(input.titleContains ? { title: { contains: input.titleContains as string, mode: "insensitive" } } : {}),
      },
      select: {
        id: true, title: true, level: true, status: true, progress: true, quarter: true, ownerId: true,
        keyResults: { select: { id: true, title: true, progress: true, currentValue: true, targetValue: true, unit: true } },
      },
      orderBy: [{ progress: "asc" }, { createdAt: "desc" }],
      take: limit,
    });
    return { count: okrs.length, okrs };
  },
};

// ─────────────────────────────────────────────────────────
// SOPs (read)
// ─────────────────────────────────────────────────────────

const searchSops: ToolDefinition = {
  name: "search_sops",
  description:
    "Search the org's Standard Operating Procedures. Use to find process docs the user is asking about, or to discover what's been documented for a given workflow.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Substring matched against title/description (case-insensitive)" },
      category: { type: "string" },
      tag: { type: "string", description: "Single tag to filter by" },
      status: { type: "string", enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] },
      limit: { type: "integer" },
    },
  },
  handler: async (ctx, input) => {
    // Only SOPs the person could open (sopVisibilityWhere, the SOP list's and
    // the SOP page's rule): this listed every SOP in the workspace, drafts and
    // restricted folders included. The level is read fresh.
    const session = await callerSession(ctx);
    if (!session) return { count: 0, sops: [] };
    const visible = await sopVisibilityWhere(session);
    const limit = Math.min(30, Number(input.limit ?? 15));
    const q = input.query as string | undefined;
    const sops = await prisma.sOP.findMany({
      where: {
        AND: [visible],
        organizationId: ctx.orgId,
        ...(input.category ? { category: input.category as string } : {}),
        ...(input.status ? { status: input.status as "DRAFT" | "PUBLISHED" | "ARCHIVED" } : {}),
        ...(input.tag ? { tags: { has: input.tag as string } } : {}),
        ...(q ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        } : {}),
      },
      select: {
        id: true, title: true, description: true, category: true, subcategory: true,
        sopType: true, tags: true, status: true, version: true, publishedAt: true, updatedAt: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
    });
    return { count: sops.length, sops };
  },
};

// ─────────────────────────────────────────────────────────
// Legal contract update
// ─────────────────────────────────────────────────────────

const updateContract: ToolDefinition = {
  name: "update_contract",
  description:
    "Update a tracked contract, change status, capture renewal terms, push out an expiry date. Use this after a redline round, a signature, or a renewal decision. Auto-stamps signedAt on first SIGNED transition.",
  input_schema: {
    type: "object",
    properties: {
      contractId: { type: "string" },
      status: {
        type: "string",
        enum: ["DRAFT", "IN_REVIEW", "IN_NEGOTIATION", "AWAITING_SIGNATURE", "SIGNED", "ACTIVE", "EXPIRED", "RENEWED", "TERMINATED", "CANCELLED"],
      },
      value: { type: "number", description: "New contract value" },
      effectiveDate: { type: "string", description: "ISO date" },
      expiresAt: { type: "string", description: "ISO date" },
      autoRenew: { type: "boolean" },
      counterparty: { type: "string", description: "Updated counterparty name (rarely needed)" },
      description: { type: "string", description: "Updated description / notes" },
    },
    required: ["contractId"],
  },
  handler: async (ctx, input) => {
    const existing = await prisma.contract.findFirst({
      where: { id: input.contractId as string, organizationId: ctx.orgId },
    });
    if (!existing) return { error: "Contract not found in this org" };

    const now = new Date();
    const status = input.status as string | undefined;
    const signedAt = status === "SIGNED" && !existing.signedAt ? now : undefined;

    const contract = await prisma.contract.update({
      where: { id: existing.id },
      data: {
        ...(status !== undefined ? { status: status as "DRAFT" | "IN_REVIEW" | "IN_NEGOTIATION" | "AWAITING_SIGNATURE" | "SIGNED" | "ACTIVE" | "EXPIRED" | "RENEWED" | "TERMINATED" | "CANCELLED" } : {}),
        ...(input.value !== undefined ? { value: input.value as number } : {}),
        ...(input.effectiveDate !== undefined ? { effectiveDate: input.effectiveDate ? new Date(input.effectiveDate as string) : null } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? new Date(input.expiresAt as string) : null } : {}),
        ...(input.autoRenew !== undefined ? { autoRenew: input.autoRenew as boolean } : {}),
        ...(input.counterparty !== undefined ? { counterparty: input.counterparty as string } : {}),
        ...(input.description !== undefined ? { description: input.description as string } : {}),
        ...(signedAt ? { signedAt } : {}),
      },
      select: { id: true, title: true, counterparty: true, status: true, value: true, expiresAt: true, signedAt: true },
    });
    return { ok: true, contract };
  },
};

// ─────────────────────────────────────────────────────────
// OKR create (HR / Goals)
// ─────────────────────────────────────────────────────────

const createOkr: ToolDefinition = {
  name: "create_okr",
  description:
    "Create an OKR (objective + key results) in WorkwrK Goals. Use when the user wants to capture a goal, quarterly, individual, team, or company-wide. Key results are optional; pass them as an array if known.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Objective title, what the team is trying to achieve" },
      description: { type: "string" },
      level: { type: "string", enum: ["COMPANY", "DEPARTMENT", "INDIVIDUAL"], description: "Defaults to INDIVIDUAL" },
      quarter: { type: "string", description: "e.g. 'Q2 2026'" },
      ownerEmail: { type: "string", description: "Email of the OKR owner. Defaults to the caller." },
      startIsoDate: { type: "string" },
      endIsoDate: { type: "string" },
      keyResults: {
        type: "array",
        description: "Optional array of key results to create alongside the OKR",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            unit: { type: "string", description: "e.g. '%', '$', 'count'" },
            startValue: { type: "number", description: "Defaults to 0" },
            targetValue: { type: "number" },
          },
          required: ["title", "targetValue"],
        },
      },
    },
    required: ["title"],
  },
  handler: async (ctx, input) => {
    const session = await callerSession(ctx);
    if (!session) return { error: "You are not a member of this organization." };
    // The same rules as POST /api/okrs: a Member makes Individual goals for
    // themselves only; a manager may choose the owner and the level; and a
    // Company goal needs the Company-goal right (Owner/Admin, the People team,
    // or owning it), so nobody makes one through the assistant that they
    // could not make, fix or remove on the Goals page.
    const manager = legacyIsManagerLevel(session.user.accessLevel);
    const level = toGoalLevel(input.level ?? "INDIVIDUAL");
    if (!manager && level !== "INDIVIDUAL") {
      return { error: "Only managers can create Company or Department goals. I can create an Individual goal for you instead." };
    }
    let ownerId = ctx.userId;
    if (input.ownerEmail) {
      const owner = await prisma.user.findFirst({
        where: { email: input.ownerEmail as string, organizationId: ctx.orgId },
        select: { id: true },
      });
      if (!owner) return { error: `Owner with email '${input.ownerEmail}' not found in this org` };
      if (!manager && owner.id !== ctx.userId) {
        return { error: "You can only create goals you own. Ask your manager to set a goal for someone else." };
      }
      ownerId = owner.id;
    }
    if (level === "COMPANY") {
      const actor = await goalRightsActor(session);
      if (!mayEditGoal(actor, { level: "COMPANY", ownerId, creatorId: ctx.userId })) {
        return { error: "Only an Admin, the People team or the goal's owner can make a Company goal. Make yourself the owner, or ask an Admin." };
      }
    }

    const krs = Array.isArray(input.keyResults) ? (input.keyResults as Array<{ title: string; unit?: string; startValue?: number; targetValue: number }>) : [];

    const okr = await prisma.oKR.create({
      data: {
        organizationId: ctx.orgId,
        title: input.title as string,
        description: (input.description as string) ?? null,
        level,
        quarter: (input.quarter as string) ?? null,
        startDate: input.startIsoDate ? new Date(input.startIsoDate as string) : null,
        endDate: input.endIsoDate ? new Date(input.endIsoDate as string) : null,
        ownerId,
        keyResults: krs.length ? {
          create: krs.map((kr) => ({
            title: kr.title,
            unit: kr.unit ?? null,
            startValue: kr.startValue ?? 0,
            targetValue: kr.targetValue,
            currentValue: kr.startValue ?? 0,
          })),
        } : undefined,
      },
      select: { id: true, title: true, level: true, status: true, quarter: true, keyResults: { select: { id: true, title: true, targetValue: true, unit: true } } },
    });
    // As POST /api/okrs does: the stored progress is honest from the first
    // read, the creator is on record (the edit rule reads okr_created), and
    // someone given a goal hears about it.
    await persistGoalRollupChain(okr.id);
    logActivity({
      type: "okr_created",
      actorId: ctx.userId,
      organizationId: ctx.orgId,
      description: `Created OKR "${okr.title}" (${level}) with Ask AI`,
      targetId: okr.id,
      targetType: "okr",
    });
    if (ownerId !== ctx.userId) await notifyGoalAssigned(ownerId, okr);
    return { ok: true, okr };
  },
};

// ─────────────────────────────────────────────────────────
// Meeting create (cross-product)
// ─────────────────────────────────────────────────────────

const createMeeting: ToolDefinition = {
  name: "create_meeting",
  description:
    "Schedule a meeting in WorkwrK. Use when the user wants to capture a 1:1, standup, review, or ad-hoc. Attendees can be passed as a list of emails, unknown emails are skipped silently.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      type: {
        type: "string",
        enum: ["DAILY_STANDUP", "WEEKLY_REVIEW", "ONE_ON_ONE", "QUARTERLY_REVIEW", "ANNUAL_PLANNING", "ADHOC"],
        description: "Defaults to ADHOC",
      },
      scheduledAt: { type: "string", description: "ISO datetime (e.g. '2026-05-25T14:00:00Z')" },
      durationMinutes: { type: "integer", description: "Defaults to 30" },
      agenda: { type: "string" },
      attendeeEmails: { type: "array", items: { type: "string" }, description: "Emails of attendees in this org" },
    },
    required: ["title", "scheduledAt"],
  },
  handler: async (ctx, input) => {
    const attendeeEmails = Array.isArray(input.attendeeEmails) ? (input.attendeeEmails as string[]) : [];
    const attendees = attendeeEmails.length
      ? await prisma.user.findMany({
          where: { organizationId: ctx.orgId, email: { in: attendeeEmails } },
          select: { id: true, email: true },
        })
      : [];

    // Always include the caller as an attendee.
    const attendeeIds = new Set<string>([ctx.userId, ...attendees.map((a) => a.id)]);

    const meeting = await prisma.meeting.create({
      data: {
        organizationId: ctx.orgId,
        title: input.title as string,
        type: ((input.type as string) ?? "ADHOC") as "DAILY_STANDUP" | "WEEKLY_REVIEW" | "ONE_ON_ONE" | "QUARTERLY_REVIEW" | "ANNUAL_PLANNING" | "ADHOC",
        scheduledAt: new Date(input.scheduledAt as string),
        duration: (input.durationMinutes as number) ?? 30,
        agenda: (input.agenda as string) ?? null,
        attendees: { create: Array.from(attendeeIds).map((userId) => ({ userId })) },
      },
      select: { id: true, title: true, type: true, scheduledAt: true, duration: true },
    });
    return {
      ok: true,
      meeting,
      attendeesAttached: attendeeIds.size,
      unknownEmails: attendeeEmails.filter((e) => !attendees.some((a) => a.email === e)),
    };
  },
};

// ─────────────────────────────────────────────────────────
// SOP create
// ─────────────────────────────────────────────────────────

const createSop: ToolDefinition = {
  name: "create_sop",
  description:
    "Create a draft Standard Operating Procedure. The SOP body is created as a stub, use the editor to flesh it out. Use this when the user describes a process and wants to capture it formally.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string", description: "Short summary of what the SOP covers" },
      category: { type: "string" },
      sopType: { type: "string", enum: ["WRITTEN", "RECORDED", "CHECKLIST"], description: "Defaults to WRITTEN" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["title"],
  },
  handler: async (ctx, input) => {
    const sopType = ((input.sopType as string) ?? "WRITTEN") as "WRITTEN" | "RECORDED" | "CHECKLIST";
    if (!["WRITTEN", "RECORDED", "CHECKLIST"].includes(sopType)) {
      return { error: `Invalid sopType "${input.sopType}". Use WRITTEN, RECORDED, or CHECKLIST.` };
    }
    // Empty content must match the sopType, the editors and the
    // assignment step-counter read type-specific shapes, and a bare
    // { steps: [] } renders a CHECKLIST/RECORDED SOP as broken.
    const content =
      sopType === "CHECKLIST" ? { type: "CHECKLIST", sections: [] }
      : sopType === "RECORDED" ? { type: "recorded", steps: [] }
      : { type: "WRITTEN", body: "" };
    const tags = Array.isArray(input.tags)
      ? (input.tags as string[]).map((t) => t.trim()).filter((t) => t.length > 0 && t.length <= 40)
      : [];
    const sop = await prisma.sOP.create({
      data: {
        organizationId: ctx.orgId,
        title: (input.title as string).trim(),
        description: (input.description as string) ?? null,
        category: (input.category as string) ?? null,
        sopType,
        tags,
        content,
      },
      select: { id: true, title: true, sopType: true, status: true, category: true, tags: true },
    });
    return { ok: true, sop };
  },
};

// ─────────────────────────────────────────────────────────
// KRA create
// ─────────────────────────────────────────────────────────

const createKra: ToolDefinition = {
  name: "create_kra",
  description:
    "Create a Key Result Area (a major accountability for a role). KRAs anchor KPIs. Use when the user is defining a new accountability or restructuring a role.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      category: { type: "string" },
      roleTitle: { type: "string", description: "Optional role title to link this KRA to (case-insensitive lookup)" },
    },
    required: ["name"],
  },
  handler: async (ctx, input) => {
    let roleId: string | undefined;
    if (input.roleTitle) {
      const role = await prisma.role.findFirst({
        where: { organizationId: ctx.orgId, title: { equals: input.roleTitle as string, mode: "insensitive" } },
        select: { id: true },
      });
      if (!role) return { error: `Role '${input.roleTitle}' not found in this org` };
      roleId = role.id;
    }

    const kra = await prisma.kRA.create({
      data: {
        organizationId: ctx.orgId,
        name: input.name as string,
        description: (input.description as string) ?? null,
        category: (input.category as string) ?? null,
        roleId,
      },
      select: { id: true, name: true, category: true, roleId: true },
    });
    return { ok: true, kra };
  },
};

// ─────────────────────────────────────────────────────────
// KPI create
// ─────────────────────────────────────────────────────────

const createKpi: ToolDefinition = {
  name: "create_kpi",
  description:
    "Create a KPI (a measurable indicator). Optionally attach it to a parent KRA by name. Use when the user wants to measure something, revenue, NPS, defect rate, etc.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      type: { type: "string", enum: ["QUANTITATIVE", "QUALITATIVE"], description: "Defaults to QUANTITATIVE" },
      unit: { type: "string", description: "e.g. '%', '$', 'count'" },
      frequency: { type: "string", enum: ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY"], description: "Defaults to MONTHLY" },
      targetValue: { type: "number" },
      lowerIsBetter: { type: "boolean", description: "True for cost/defect-type metrics" },
      kraName: { type: "string", description: "Optional parent KRA, looked up by name (case-insensitive)" },
    },
    required: ["name"],
  },
  handler: async (ctx, input) => {
    let kraId: string | undefined;
    if (input.kraName) {
      const kra = await prisma.kRA.findFirst({
        where: { organizationId: ctx.orgId, name: { equals: input.kraName as string, mode: "insensitive" } },
        select: { id: true },
      });
      if (!kra) return { error: `KRA '${input.kraName}' not found in this org` };
      kraId = kra.id;
    }

    const kpi = await prisma.kPI.create({
      data: {
        organizationId: ctx.orgId,
        name: input.name as string,
        description: (input.description as string) ?? null,
        type: ((input.type as string) ?? "QUANTITATIVE") as "QUANTITATIVE" | "QUALITATIVE",
        unit: (input.unit as string) ?? null,
        frequency: ((input.frequency as string) ?? "MONTHLY") as "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUALLY",
        targetValue: input.targetValue as number | undefined,
        lowerIsBetter: (input.lowerIsBetter as boolean) ?? false,
        kraId,
      },
      select: { id: true, name: true, type: true, unit: true, frequency: true, targetValue: true, kraId: true },
    });
    return { ok: true, kpi };
  },
};

const createWorkspaceTool: ToolDefinition = {
  name: "create_workspace",
  description:
    "Spin up a named workspace inside a product (e.g. 'Sales Team B' inside CRM). Use this when the user asks to set up a separate team space, or when you're about to populate one, you can chain this with `create_studio_board` to seed boards into the new workspace.",
  input_schema: {
    type: "object",
    properties: {
      product: { type: "string", description: "Product slug (e.g. workwrk-crm, workwrk-dev)." },
      name: { type: "string", description: "Display name (e.g. 'Enterprise sales team')." },
      description: { type: "string", description: "Optional one-line description." },
      color: { type: "string", description: "Optional accent color." },
    },
    required: ["product", "name"],
  },
  async handler(ctx, input) {
    // Same rule as POST /api/workspaces: a manager or above creates one.
    if (!legacyIsManagerLevel(await callerLevel(ctx))) {
      return { error: "Only a manager or an admin can create a workspace. Ask one of them." };
    }
    const { createWorkspace } = await import("@/lib/workspaces");
    const ws = await createWorkspace({
      organizationId: ctx.orgId,
      productSlug: String(input.product),
      userId: ctx.userId,
      name: String(input.name),
      color: input.color as string | undefined,
      description: input.description as string | undefined,
    });
    return {
      ok: true,
      workspace: {
        id: ws.id,
        slug: ws.slug,
        name: ws.name,
      },
    };
  },
};

const invitePersonWithRole: ToolDefinition = {
  name: "invite_person_with_role",
  description:
    "Send an invitation to a new hire. Attach a roleId and the role's KRAs plus their published SOPs seed automatically when the invite is accepted, kraIds/sopIds are OPTIONAL explicit overrides, not requirements. The invitee gets the standard /join?token=… email flow.",
  input_schema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Invitee email." },
      accessLevel: { type: "string", description: "EMPLOYEE / MANAGER / DIRECTOR / etc. Defaults to EMPLOYEE." },
      departmentId: { type: "string" },
      roleId: { type: "string" },
      managerId: { type: "string", description: "User id of the reporting manager." },
      officeId: { type: "string" },
      kraIds: { type: "array", items: { type: "string" }, description: "KRA ids to assign on accept. Required, ≥ 1." },
      sopIds: { type: "array", items: { type: "string" }, description: "SOP ids to assign on accept. Required, ≥ 1." },
    },
    required: ["email", "kraIds", "sopIds"],
  },
  async handler(ctx, input) {
    // Same gate as POST /api/invitations (the People create permission), and
    // the level comes from a closed list: the model's input can never mint an
    // admin, and a person who cannot invite from the UI cannot invite here.
    // hasPermission itself, so the engine's rule answers here too once
    // ACCESS_V2_RESOLVER is on (Owner and Admin), exactly as the route does.
    const level = await callerLevel(ctx);
    const caller = await callerSession(ctx);
    if (!level || !caller || !(await hasPermission(caller, "people", "create"))) {
      return { error: "You can't invite people. Ask an admin to send the invitation." };
    }
    // The level follows the ONE invite rule (src/lib/access/invite-level.ts),
    // the same as POST /api/invitations: at most the inviter's own rung,
    // never an admin unless the inviter is one. A refused level is an
    // error the model reports, never a silent downgrade.
    const requested = String(input.accessLevel ?? "EMPLOYEE").toUpperCase();
    const levelCheck = resolveInviteLevel(level, requested);
    if (!levelCheck.ok) return { error: levelCheck.error };
    const inviteLevel = levelCheck.level;
    const email = String(input.email ?? "").trim();
    if (!email.includes("@")) throw new Error("Valid email is required");
    const kraIds = Array.isArray(input.kraIds) ? (input.kraIds as string[]) : [];
    const sopIds = Array.isArray(input.sopIds) ? (input.sopIds as string[]) : [];
    // kraIds/sopIds optional since 2026-08-27: the role carries the
    // definition; explicit ids remain supported as overrides.

    // Duplicates / existing-user check, same as POST /api/invitations.
    const existingUser = await prisma.user.findFirst({
      where: { email, organizationId: ctx.orgId },
      select: { id: true },
    });
    if (existingUser) throw new Error("A user with this email already exists in this org");
    const existingInvite = await prisma.invitation.findFirst({
      where: { email, organizationId: ctx.orgId, accepted: false },
      select: { id: true },
    });
    if (existingInvite) throw new Error("There's already a pending invitation for this email");

    // Cross-tenant safety on the KRA/SOP ids.
    const kraCount = await prisma.kRA.count({ where: { id: { in: kraIds }, organizationId: ctx.orgId } });
    if (kraCount !== kraIds.length) throw new Error("One or more KRAs don't belong to this org");
    const sopCount = await prisma.sOP.count({ where: { id: { in: sopIds }, organizationId: ctx.orgId } });
    if (sopCount !== sopIds.length) throw new Error("One or more SOPs don't belong to this org");

    const crypto = await import("crypto");
    const invitation = await prisma.invitation.create({
      data: {
        email,
        accessLevel: inviteLevel as "EMPLOYEE",
        token: crypto.randomBytes(32).toString("hex"),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        organizationId: ctx.orgId,
        departmentId: (input.departmentId as string | undefined) ?? null,
        roleId: (input.roleId as string | undefined) ?? null,
        managerId: (input.managerId as string | undefined) ?? null,
        officeId: (input.officeId as string | undefined) ?? null,
        kraIds,
        sopIds,
      },
      select: { id: true, email: true, token: true },
    });

    return {
      ok: true,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        // Token is sensitive, don't echo it back in chat. The email
        // worker already includes the registration link.
        registerLink: `/join?token=…`,
      },
    };
  },
};

// ─────────────────────────────────────────────────────────
// Lego primitives, Forms, DataTables, Docs
// ─────────────────────────────────────────────────────────

const FORM_FIELD_TYPES = ["short_text", "long_text", "number", "email", "url", "date", "select", "multi_select", "checkbox"] as const;
const TABLE_COL_TYPES = ["short_text", "long_text", "number", "select", "multi_select", "date", "checkbox", "url", "email"] as const;
const DOC_BLOCK_KINDS = ["h1", "h2", "h3", "paragraph", "todo", "callout", "divider"] as const;

function rid() { return Math.random().toString(36).slice(2, 10); }

const createForm: ToolDefinition = {
  name: "create_form",
  description:
    "Create a Form in WorkwrK. Use this when the user wants to collect structured answers from people, such as feedback, applications, requests or signups. Returns the form id and the responder URL.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short name of the form (e.g. 'Customer feedback')" },
      description: { type: "string", description: "Optional one-liner shown to respondents" },
      isPublic: { type: "boolean", description: "Ignored: a new form is always private. Its public link is turned on in the form's Share dialog by its maker or an admin, behind a confirm." },
      fields: {
        type: "array",
        description: "Form fields, 1-20 items. Each field has type, label, required.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...FORM_FIELD_TYPES] },
            label: { type: "string" },
            required: { type: "boolean" },
            options: { type: "array", items: { type: "string" }, description: "Required for select/multi_select" },
          },
          required: ["type", "label"],
        },
      },
    },
    required: ["name", "fields"],
  },
  handler: async (ctx, input) => {
    const fields = Array.isArray(input.fields) ? input.fields : [];
    const safe = fields
      .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && FORM_FIELD_TYPES.includes((f as { type: string }).type as typeof FORM_FIELD_TYPES[number]))
      .slice(0, 20)
      .map((f) => ({
        id: rid(),
        type: (f as { type: string }).type,
        label: String((f as { label: string }).label ?? "Untitled").slice(0, 80),
        required: Boolean((f as { required?: boolean }).required),
        ...(((f as { type: string }).type === "select" || (f as { type: string }).type === "multi_select")
          ? { options: Array.isArray((f as { options?: unknown[] }).options) ? ((f as { options: unknown[] }).options.map(String).slice(0, 20)) : ["Option 1"] }
          : {}),
      }));

    const form = await prisma.formDefinition.create({
      data: {
        organizationId: ctx.orgId,
        name: String(input.name).slice(0, 200),
        description: input.description ? String(input.description).slice(0, 2000) : null,
        // Never public from a tool call: publishing is a confirmed act by the
        // form's maker or an admin (spec-tables-forms section 3 ask 1), and
        // POST /api/forms ignores isPublic for the same reason.
        isPublic: false,
        fields: safe,
        createdById: ctx.userId,
      },
      select: { id: true, name: true },
    });
    return { ok: true, form: { id: form.id, name: form.name, responderUrl: `/forms/${form.id}/respond`, editorUrl: addressHref("form", form.id, { scope: "work" }) } };
  },
};

/**
 * The refs this person may open (Can view or higher), as refKey strings: one
 * world through the one resolver, so the Ask AI tools never name a node the
 * product hides from the person anywhere else.
 */
async function readableIds(ctx: ToolContext, refs: NodeRef[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (refs.length === 0) return out;
  const decisions = await nodeRoles(await nodeCtxForUser(ctx.userId, ctx.orgId), refs);
  for (const [key, d] of decisions) if (roleAtLeast(d.role, "VIEW")) out.add(key);
  return out;
}

const listForms: ToolDefinition = {
  name: "list_forms",
  description: "List Forms in the user's org with submission counts, optionally by part of a name. Use this when the user asks about existing forms or wants to find one.",
  input_schema: {
    type: "object",
    properties: { nameContains: { type: "string", description: "Case-insensitive part of the form's name" } },
  },
  handler: async (ctx, input) => {
    // Paged until 50 readable forms are found: the newest 200 filtered once
    // left a reader whose forms are older with an empty list.
    const name = typeof input.nameContains === "string" && input.nameContains.trim() ? input.nameContains.trim() : null;
    const page = (after: { id: string; updatedAt: Date } | null, take: number) => prisma.formDefinition.findMany({
      where: { organizationId: ctx.orgId, ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}), AND: [olderThan(after)] },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take,
      select: { id: true, name: true, isPublic: true, updatedAt: true, _count: { select: { submissions: true } } },
    });
    const { rows: forms, capped, scanned } = await collectReadable({
      limit: 50,
      batch: 200,
      maxScan: 2000,
      page,
      keep: async (batch: Awaited<ReturnType<typeof page>>) => {
        const readable = await readableIds(ctx, batch.map((f) => ({ kind: "form" as const, id: f.id })));
        return batch.filter((f) => readable.has(refKey({ kind: "form", id: f.id })));
      },
    });
    return {
      forms: forms.map((f) => ({ id: f.id, name: f.name, isPublic: f.isPublic, submissionCount: f._count.submissions })),
      ...(capped ? { partial: true, searched: scanned, note: "Only the 2,000 most recently updated forms were searched. Add part of the form's name to narrow the search." } : {}),
    };
  },
};

const createDataTable: ToolDefinition = {
  name: "create_data_table",
  description:
    "Create a Table (a spreadsheet: named, typed columns and rows) in WorkwrK. Use this when the user wants to track a list of things with shared attributes, such as vendors, competitors, leads or equipment. Returns the table id and URL.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      columns: {
        type: "array",
        description: "Columns, 1-20 items.",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...TABLE_COL_TYPES] },
            label: { type: "string" },
            options: { type: "array", items: { type: "string" }, description: "Required for select/multi_select" },
          },
          required: ["type", "label"],
        },
      },
    },
    required: ["name", "columns"],
  },
  handler: async (ctx, input) => {
    const cols = Array.isArray(input.columns) ? input.columns : [];
    const safe = cols
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && TABLE_COL_TYPES.includes((c as { type: string }).type as typeof TABLE_COL_TYPES[number]))
      .slice(0, 20)
      .map((c) => ({
        id: rid(),
        type: (c as { type: string }).type,
        label: String((c as { label: string }).label ?? "Untitled").slice(0, 60),
        ...(((c as { type: string }).type === "select" || (c as { type: string }).type === "multi_select")
          ? { options: Array.isArray((c as { options?: unknown[] }).options) ? ((c as { options: unknown[] }).options.map(String).slice(0, 20)) : ["Option 1"] }
          : {}),
      }));

    const table = await prisma.dataTable.create({
      data: {
        organizationId: ctx.orgId,
        name: String(input.name).slice(0, 200),
        description: input.description ? String(input.description).slice(0, 2000) : null,
        columns: safe,
        createdById: ctx.userId,
      },
      select: { id: true, name: true },
    });
    return { ok: true, table: { id: table.id, name: table.name, url: addressHref("table", table.id, { scope: "work" }) } };
  },
};

const listDataTables: ToolDefinition = {
  name: "list_data_tables",
  description: "List the Tables in the user's org with row counts, optionally by part of a name.",
  input_schema: {
    type: "object",
    properties: { nameContains: { type: "string", description: "Case-insensitive part of the table's name" } },
  },
  handler: async (ctx, input) => {
    // Only the tables this person can open (their Space, their own, a grant),
    // paged until 50 are found: the newest 200 filtered once could leave a
    // reader whose tables are older with an empty list.
    const name = typeof input.nameContains === "string" && input.nameContains.trim() ? input.nameContains.trim() : null;
    const page = (after: { id: string; updatedAt: Date } | null, take: number) => prisma.dataTable.findMany({
      where: { organizationId: ctx.orgId, ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}), AND: [olderThan(after)] },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take,
      select: { id: true, name: true, updatedAt: true, _count: { select: { rows: { where: { deletedAt: null } } } } },
    });
    const { rows: tables, capped, scanned } = await collectReadable({
      limit: 50,
      batch: 200,
      maxScan: 2000,
      page,
      keep: async (batch: Awaited<ReturnType<typeof page>>) => {
        const readable = await readableIds(ctx, batch.map((t) => ({ kind: "table" as const, id: t.id })));
        return batch.filter((t) => readable.has(refKey({ kind: "table", id: t.id })));
      },
    });
    return {
      tables: tables.map((t) => ({ id: t.id, name: t.name, rowCount: t._count.rows })),
      ...(capped ? { partial: true, searched: scanned, note: "Only the 2,000 most recently updated tables were searched. Add part of the table's name to narrow the search." } : {}),
    };
  },
};

const createDocWithBlocks: ToolDefinition = {
  name: "create_doc",
  description:
    "Create a block-based Doc in WorkwrK with a title and a sequence of blocks. Use this for runbooks, plans, briefs, summaries. Each block has a `kind` (h1/h2/h3/paragraph/todo/callout/divider) and a `text` string (except divider).",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      blocks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...DOC_BLOCK_KINDS] },
            text: { type: "string" },
          },
          required: ["kind"],
        },
      },
    },
    required: ["title", "blocks"],
  },
  handler: async (ctx, input) => {
    const raw = Array.isArray(input.blocks) ? input.blocks : [];
    const blocks = raw
      .filter((b): b is Record<string, unknown> => !!b && typeof b === "object" && DOC_BLOCK_KINDS.includes((b as { kind: string }).kind as typeof DOC_BLOCK_KINDS[number]))
      .slice(0, 200)
      .map((b) => {
        const kind = (b as { kind: string }).kind;
        if (kind === "divider") return { id: rid(), kind };
        if (kind === "todo") return { id: rid(), kind, text: String((b as { text?: string }).text ?? ""), done: false };
        if (kind === "callout") return { id: rid(), kind, text: String((b as { text?: string }).text ?? ""), tone: "info" };
        return { id: rid(), kind, text: String((b as { text?: string }).text ?? "") };
      });

    const title = String(input.title).slice(0, 200);
    const doc = await prisma.doc.create({
      data: {
        organizationId: ctx.orgId,
        title,
        content: { blocks } as never,
        createdById: ctx.userId,
        versions: { create: { version: 1, title, content: { blocks } as never, authorId: ctx.userId } },
      },
      select: { id: true, title: true },
    });
    return { ok: true, doc: { id: doc.id, title: doc.title, url: addressHref("doc", doc.id, { scope: "work" }) } };
  },
};

// ─────────────────────────────────────────────────────────
// Brain knowledge tools, read-only org awareness so the
// right-dock Brain panel can actually answer "who is at
// risk on KPI compliance" / "what are my KRAs" / etc.
// All scoped to ctx.userId or ctx.orgId; nothing crosses
// org boundaries.
// ─────────────────────────────────────────────────────────

const listMyKras: ToolDefinition = {
  name: "list_my_kras",
  description:
    "List the caller's active Key Result Area assignments (KRAs), what the user is accountable for. Returns each KRA's name, weightage, status, and the role it's tied to.",
  input_schema: {
    type: "object",
    properties: {
      includePaused: { type: "boolean", description: "Include PAUSED assignments. Default false." },
    },
  },
  handler: async (ctx, input) => {
    const includePaused = input.includePaused === true;
    const assignments = await prisma.kRAAssignment.findMany({
      where: {
        userId: ctx.userId,
        status: includePaused ? { in: ["ACTIVE", "PAUSED"] } : "ACTIVE",
        kra: { organizationId: ctx.orgId },
      },
      include: { kra: { select: { id: true, name: true, description: true, category: true } } },
      orderBy: { weightage: "desc" },
    });
    return {
      count: assignments.length,
      kras: assignments.map((a) => ({
        kraId: a.kraId,
        name: a.kra.name,
        category: a.kra.category,
        description: a.kra.description,
        weightage: a.weightage,
        status: a.status,
        period: a.period,
      })),
    };
  },
};

const listMyKpiStatus: ToolDefinition = {
  name: "list_my_kpi_status",
  description:
    "List the caller's KPI prompts for the current measurement period with target, actual, score, and submission status. Use this to answer 'am I on track on my KPIs', 'what KPIs do I owe', or 'what's my current performance'.",
  input_schema: {
    type: "object",
    properties: {
      period: { type: "string", description: "Optional period code (e.g. '2026-06'). Defaults to current period." },
    },
  },
  handler: async (ctx, input) => {
    const { getCurrentPeriod } = await import("@/lib/kpi-utils");
    const period = (input.period as string) || getCurrentPeriod();
    const records = await prisma.kPIRecord.findMany({
      where: {
        userId: ctx.userId,
        period,
        kpi: { organizationId: ctx.orgId },
      },
      include: {
        kpi: {
          select: { id: true, name: true, unit: true, frequency: true, lowerIsBetter: true, kraId: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    return {
      period,
      count: records.length,
      records: records.map((r) => ({
        kpiId: r.kpiId,
        kpiName: r.kpi.name,
        unit: r.kpi.unit,
        frequency: r.kpi.frequency,
        target: r.targetValue,
        actual: r.actualValue,
        score: r.score,
        status: r.status,
        lowerIsBetter: r.kpi.lowerIsBetter,
        kraId: r.kpi.kraId,
      })),
    };
  },
};

const listMySops: ToolDefinition = {
  name: "list_my_sops",
  description:
    "List the SOPs assigned to the caller, with completion status, mandatory/optional, due date, and progress. Use this to answer 'what SOPs do I owe', 'have I read X', or 'what training is mandatory and overdue'.",
  input_schema: {
    type: "object",
    properties: {
      onlyOpen: { type: "boolean", description: "Only show ASSIGNED or IN_PROGRESS assignments. Default true." },
    },
  },
  handler: async (ctx, input) => {
    const onlyOpen = input.onlyOpen !== false;
    const rows = await prisma.sOPAssignment.findMany({
      where: {
        userId: ctx.userId,
        sop: { organizationId: ctx.orgId },
        ...(onlyOpen ? { status: { in: ["ASSIGNED", "IN_PROGRESS"] } } : {}),
      },
      include: { sop: { select: { id: true, title: true, category: true } } },
      orderBy: [{ mandatory: "desc" }, { dueDate: "asc" }],
      take: 50,
    });
    return {
      count: rows.length,
      sops: rows.map((r) => ({
        sopId: r.sopId,
        title: r.sop.title,
        category: r.sop.category,
        status: r.status,
        mandatory: r.mandatory,
        dueDate: r.dueDate ? r.dueDate.toISOString() : null,
        stepsTotal: r.stepsTotal,
        stepsCompleted: r.stepsCompleted,
        score: r.score,
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      })),
    };
  },
};

const listMyWeeklyReviews: ToolDefinition = {
  name: "list_my_weekly_reviews",
  description:
    "List the caller's recent weekly reviews (last 8 by default), period, status, manager review state, and a short excerpt of highlights/blockers/plan. Use this to summarize what the user has been working on or whether they're behind on submission.",
  input_schema: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "How many recent reviews to return. Default 8, max 26." },
    },
  },
  handler: async (ctx, input) => {
    const requested = typeof input.limit === "number" ? input.limit : 8;
    const take = Math.max(1, Math.min(26, Math.floor(requested)));
    const rows = await prisma.weeklyReview.findMany({
      where: { userId: ctx.userId, organizationId: ctx.orgId },
      orderBy: { periodStart: "desc" },
      take,
    });
    const excerpt = (s: string | null, n = 240) =>
      !s ? null : s.length > n ? s.slice(0, n - 1) + "…" : s;
    return {
      count: rows.length,
      reviews: rows.map((r) => ({
        id: r.id,
        periodStart: r.periodStart.toISOString(),
        status: r.status,
        managerStatus: r.managerStatus,
        submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
        reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
        highlights: excerpt(r.highlights),
        blockers: excerpt(r.blockers),
        plan: excerpt(r.plan),
      })),
    };
  },
};

const getTeamAlignmentRollup: ToolDefinition = {
  name: "get_team_alignment_rollup",
  description:
    "Manager-only. Return the full team-alignment rollup for the caller's reports (solid + dotted): per-report KRAs, KPI compliance %, SOP read-rate %, and this week's review status. Use this to answer 'who is at risk on KPI compliance', 'who hasn't submitted their weekly review', or 'what is my team working on'.",
  input_schema: {
    type: "object",
    properties: {},
  },
  handler: async (ctx) => {
    const { getTeamAlignment } = await import("@/lib/team-alignment");
    const rollup = await getTeamAlignment({ managerId: ctx.userId, organizationId: ctx.orgId });
    if (rollup.members.length === 0) {
      return {
        empty: true,
        reason: "Caller has no direct or dotted-line reports, they are an IC, not a manager.",
      };
    }
    // Strip avatars / heavy fields the model doesn't need.
    return {
      reportCount: rollup.totals.reportCount,
      avgKpiCompliancePct: rollup.totals.avgKpiCompliancePct,
      avgSopReadRatePct: rollup.totals.avgSopReadRatePct,
      activeKrasTotal: rollup.totals.activeKras,
      members: rollup.members.map((m) => ({
        userId: m.id,
        name: `${m.firstName} ${m.lastName}`.trim(),
        email: m.email,
        via: m.via,
        kras: m.activeKras,
        kpiCompliancePct: m.kpis.compliancePct,
        kpiPending: m.kpis.pending,
        kpiSubmitted: m.kpis.submitted,
        kpiApproved: m.kpis.approved,
        sopReadRatePct: m.sops.readRatePct,
        sopMandatoryPending: m.sops.mandatoryPending,
        weeklyReview: m.weeklyReview,
      })),
    };
  },
};

// The registry, typed against the one name list (tool-names.ts): a missing or
// extra entry is a compile error, which is what keeps the chat thread's verb
// map and this table the same 28 names.
const REGISTRY = {
  // Lego primitives
  create_form: createForm,
  list_forms: listForms,
  create_data_table: createDataTable,
  list_data_tables: listDataTables,
  create_doc: createDocWithBlocks,
  // Cross-product
  create_task: createTask,
  search_tasks: searchTasks,
  send_kudos: sendKudos,
  search_employees: searchEmployees,
  search_meetings: searchMeetings,
  search_okrs: searchOkrs,
  search_sops: searchSops,
  // Contracts
  create_contract: createContract,
  search_contracts: searchContracts,
  update_contract: updateContract,
  // Sprints
  create_sprint: createSprint,
  // Goals, meetings, SOPs, KRAs and KPIs
  create_okr: createOkr,
  create_meeting: createMeeting,
  create_sop: createSop,
  create_kra: createKra,
  create_kpi: createKpi,
  // System-building tools: workspaces and invitations (both role-gated in
  // their handlers)
  create_workspace: createWorkspaceTool,
  invite_person_with_role: invitePersonWithRole,
  // Read-only org awareness. Manager-only ones answer gracefully when the
  // caller has no reports.
  list_my_kras: listMyKras,
  list_my_kpi_status: listMyKpiStatus,
  list_my_sops: listMySops,
  list_my_weekly_reviews: listMyWeeklyReviews,
  get_team_alignment_rollup: getTeamAlignmentRollup,
} satisfies Record<ToolName, ToolDefinition>;

export const TOOLS: Record<string, ToolDefinition> = REGISTRY;

// Tools every session can use, regardless of agent (or no agent).
export const CROSS_TOOL_NAMES: ToolName[] = [
  "create_task", "search_tasks", "send_kudos", "search_employees",
  "search_meetings", "search_okrs", "search_sops",
  "create_meeting", "create_okr", "create_sop",
  // System-building tools: workspaces and invitations
  "create_workspace", "invite_person_with_role",
  // Lego primitives: Forms, DataTables, Docs
  "create_form", "list_forms",
  "create_data_table", "list_data_tables",
  "create_doc",
  // Read-only org awareness
  "list_my_kras", "list_my_kpi_status", "list_my_sops",
  "list_my_weekly_reviews", "get_team_alignment_rollup",
];

// Tools per agent product. When a chat session is scoped to an agent,
// the agent's productSlug determines which create-tools light up in
// addition to the cross-product ones. The CRM, ITSM, campaigns and helpdesk
// rows left with their tools (PPMS scope); an agent bound to one of those
// products gets the cross-product set only.
export const PRODUCT_TOOL_NAMES: Record<string, ToolName[]> = {
  "workwrk-contracts": ["create_contract", "search_contracts", "update_contract"],
  "workwrk-dev": ["create_sprint"],
  // HR / Goals: KRAs and KPIs are org-design primitives, surfaced via the
  // People product's agent.
  "workwrk-people": ["create_kra", "create_kpi"],
  "workwrk-goals": ["create_okr"],
  "workwrk-sops": ["create_sop"],
  "workwrk-meetings": ["create_meeting"],
};

// Resolve which tools are available to a given chat session.
//   - General Sidekick (no agent): just CROSS_TOOL_NAMES
//   - Agent: CROSS + the agent's product's tools
export function toolsForSession(opts: { agentProductSlug?: string | null }): ToolDefinition[] {
  const available = new Set<ToolName>(CROSS_TOOL_NAMES);
  if (opts.agentProductSlug) {
    const productTools = PRODUCT_TOOL_NAMES[opts.agentProductSlug] ?? [];
    for (const name of productTools) available.add(name);
  }
  return Array.from(available).map((name) => TOOLS[name]).filter((t): t is ToolDefinition => Boolean(t));
}
