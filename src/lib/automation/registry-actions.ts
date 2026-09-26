import { prisma } from "@/lib/prisma";
import { archiveBoardItem, createBoardItem, moveBoardItem, updateBoardItem, getBoardStatuses } from "@/lib/board-items";
import { queueEmail } from "@/lib/email";
import { parseBoardSchema } from "@/lib/field-catalog";
import { remapStatusOnMove } from "@/lib/item-move";
import { createUpdate } from "@/lib/item-thread";
import { resolveField } from "./conditions";
import { coerceSetFieldValue } from "./set-field";
import { authorCanWrite, loadAuthor, type AutomationAuthor } from "./author-reach";

/**
 * Action catalog + per-action execute() implementations.
 *
 * Every execute() runs inside the engine's step wrapper: throwing is
 * fine and expected on failure — the engine records the error on the
 * AutomationRunStep and computes PARTIAL/FAILED. Actions must be
 * org-scoped (never touch a record outside ctx.organizationId) and
 * idempotent where `safeToRetry: true`.
 *
 * Param values support `{{field}}` interpolation from the trigger
 * payload ("{{title}}", "{{metadata.city}}").
 */

export interface ActionContext {
  organizationId: string;
  eventKey: string;
  payload: Record<string, unknown>;
  recordId: string | null;
  recordType: string | null;
  workflowId: string;
  runId: string;
  /** Automation chain depth: re-dispatched events carry depth + 1. */
  depth: number;
  /** The workflow's creator: the author of a comment it adds, and whose reach caps every write. */
  workflowCreatorId?: string | null;
  /** The creator's reach, when the engine already loaded it (author-reach.ts). */
  author?: AutomationAuthor | null;
  /** This step's order in the run, so a delivery id is unique per step. */
  stepOrder?: number;
}

export interface ActionParamField {
  key: string;
  label: string;
  /** `board` is a List picker; `field` picks one of a List's own fields. */
  type: "string" | "text" | "user" | "board" | "status" | "number" | "field";
  required: boolean;
  help?: string;
}

export interface AutomationAction {
  key: string;
  name: string;
  category: string;
  description: string;
  /** Failed steps of retry-safe actions are re-run by the retry cron. */
  safeToRetry: boolean;
  /** True when the action executes for real today (honest catalog). */
  available: boolean;
  /** Requires a CONNECTED IntegrationConnection of this provider. */
  requiresConnection?: "WHATSAPP" | "GMAIL" | "GOOGLE_CALENDAR" | "SLACK" | "WEBHOOK";
  params: ActionParamField[];
  execute(ctx: ActionContext, params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** Replace {{dot.path}} tokens with values from the trigger payload. */
export function interpolate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const v = resolveField(payload, path);
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString();
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

function paramString(params: Record<string, unknown>, key: string, payload: Record<string, unknown>): string | null {
  const raw = params[key];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return interpolate(raw, payload).trim() || null;
}

/**
 * Resolve a user-ish param: an explicit user id, or the special values
 * "assignee" / "actor" (read from the trigger payload) / "board_owner"
 * (the owning board's ownerId, via payload.boardId). Verifies org
 * membership + ACTIVE status (the plan's "inactive assignee" edge case).
 */
async function resolveUser(
  ctx: ActionContext,
  raw: string,
): Promise<{ id: string; email: string; firstName: string; lastName: string }> {
  let userId = raw;
  if (raw === "assignee") {
    const v = ctx.payload.ownerId ?? ctx.payload.assigneeId ?? ctx.payload.userId;
    if (typeof v !== "string" || !v) throw new Error("The trigger payload has no assignee to resolve");
    userId = v;
  } else if (raw === "actor") {
    const v = ctx.payload.actorId;
    if (typeof v !== "string" || !v) throw new Error("The trigger payload has no actor to resolve");
    userId = v;
  } else if (raw === "board_owner") {
    const boardId = typeof ctx.payload.boardId === "string" && ctx.payload.boardId ? ctx.payload.boardId : null;
    if (!boardId) throw new Error("The trigger payload has no board to resolve an owner from");
    const board = await prisma.board.findFirst({
      where: { id: boardId, organizationId: ctx.organizationId },
      select: { ownerId: true },
    });
    if (!board) throw new Error("Board no longer exists (deleted or outside this workspace)");
    if (!board.ownerId) throw new Error("This board has no owner to resolve");
    userId = board.ownerId;
  }
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: ctx.organizationId },
    select: { id: true, email: true, firstName: true, lastName: true, status: true },
  });
  if (!user) throw new Error("User not found in this workspace");
  if (user.status !== "ACTIVE") throw new Error(`User ${user.firstName} ${user.lastName} is not active`);
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName };
}

/** Load an org-owned board item (the automation's target record). */
async function resolveItem(ctx: ActionContext, params: Record<string, unknown>) {
  const itemId = paramString(params, "itemId", ctx.payload) ?? ctx.recordId;
  if (!itemId) throw new Error("No target task: the trigger payload has no record id");
  const item = await prisma.item.findFirst({
    where: { id: itemId, organizationId: ctx.organizationId },
    select: { id: true, boardId: true, title: true, status: true, ownerId: true, priority: true, archivedAt: true },
  });
  if (!item) throw new Error("Task no longer exists (deleted or outside this workspace)");
  return item;
}

/**
 * An automation never writes further than its creator can (author-reach.ts):
 * the step fails with a sentence the run drawer shows. A workflow with no
 * creator on record keeps the behaviour it always had.
 */
async function assertCanWrite(ctx: ActionContext, boardId: string): Promise<void> {
  if (!ctx.workflowCreatorId) return;
  const author = ctx.author !== undefined ? ctx.author : await loadAuthor(ctx.organizationId, ctx.workflowCreatorId);
  if (!(await authorCanWrite(author, boardId))) {
    throw new Error("The person who made this automation cannot make changes in that List, so it was left alone");
  }
}

/**
 * Re-dispatch a follow-up event with depth + 1 so chained automations
 * fire while the engine's anti-loop guard still applies. Dynamic import
 * breaks the webhookDispatcher → engine → actions static cycle.
 */
async function emitChained(ctx: ActionContext, event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const { dispatchEvent } = await import("@/services/webhookDispatcher");
    await dispatchEvent({
      organizationId: ctx.organizationId,
      event,
      payload: { ...payload, __automationDepth: ctx.depth + 1 },
    });
  } catch {
    // Chained fan-out is best-effort — the action itself already succeeded.
  }
}

export const AUTOMATION_ACTIONS: AutomationAction[] = [
  {
    key: "assign_user",
    name: "Assign a person",
    category: "Tasks",
    description: "Set the task's assignee to a specific person.",
    safeToRetry: true, // idempotent state-set
    available: true,
    params: [
      { key: "userId", label: "Assignee", type: "user", required: true, help: 'A member, or "assignee"/"actor"/"board_owner" from the trigger' },
      { key: "itemId", label: "Task", type: "string", required: false, help: "Defaults to the triggering task" },
    ],
    async execute(ctx, params) {
      const raw = paramString(params, "userId", ctx.payload);
      if (!raw) throw new Error("assign_user requires a userId param");
      const item = await resolveItem(ctx, params);
      await assertCanWrite(ctx, item.boardId);
      const user = await resolveUser(ctx, raw);
      if (item.ownerId === user.id) {
        return { itemId: item.id, assigneeId: user.id, changed: false };
      }
      await updateBoardItem(item.id, { ownerId: user.id }, null);
      await emitChained(ctx, "task.assignee_changed", {
        id: item.id,
        boardId: item.boardId,
        title: item.title,
        status: item.status,
        ownerId: user.id,
        assigneeId: user.id,
        previousAssigneeId: item.ownerId,
        priority: item.priority,
      });
      return { itemId: item.id, assigneeId: user.id, changed: true };
    },
  },
  {
    key: "update_status",
    name: "Change status",
    category: "Tasks",
    description: "Move the task to a different status.",
    safeToRetry: true, // idempotent state-set
    available: true,
    params: [
      { key: "status", label: "Status", type: "status", required: true },
      { key: "itemId", label: "Task", type: "string", required: false, help: "Defaults to the triggering task" },
    ],
    async execute(ctx, params) {
      const status = paramString(params, "status", ctx.payload);
      if (!status) throw new Error("update_status requires a status param");
      const item = await resolveItem(ctx, params);
      await assertCanWrite(ctx, item.boardId);
      const board = await prisma.board.findFirst({
        where: { id: item.boardId, organizationId: ctx.organizationId },
        select: { statuses: true },
      });
      const palette = getBoardStatuses(board);
      const match = palette.find((s) => s.value.toLowerCase() === status.toLowerCase());
      if (!match) {
        // Renamed/deleted status — fail loudly instead of writing junk.
        throw new Error(`Status "${status}" does not exist on this board`);
      }
      if (item.status === match.value) {
        return { itemId: item.id, status: match.value, changed: false };
      }
      await updateBoardItem(item.id, { status: match.value }, null);
      await emitChained(ctx, "task.status_changed", {
        id: item.id,
        boardId: item.boardId,
        title: item.title,
        status: match.value,
        previousStatus: item.status,
        ownerId: item.ownerId,
        assigneeId: item.ownerId,
        priority: item.priority,
      });
      return { itemId: item.id, status: match.value, changed: true };
    },
  },
  {
    key: "create_task",
    name: "Create a task",
    category: "Tasks",
    description: "Create a new task in a List.",
    // NOT retry-safe: a re-run after a mid-flight failure could create
    // a duplicate task (the plan's dup-task guard).
    safeToRetry: false,
    available: true,
    params: [
      { key: "boardId", label: "List", type: "board", required: true },
      { key: "title", label: "Title", type: "string", required: true, help: "Supports {{field}} tokens from the trigger" },
      { key: "status", label: "Status", type: "status", required: false },
      { key: "ownerId", label: "Assignee", type: "user", required: false },
      { key: "priority", label: "Priority", type: "string", required: false },
      { key: "dueInDays", label: "Due in (days)", type: "number", required: false },
    ],
    async execute(ctx, params) {
      const boardId = paramString(params, "boardId", ctx.payload);
      const title = paramString(params, "title", ctx.payload);
      if (!boardId) throw new Error("create_task requires a boardId param");
      if (!title) throw new Error("create_task requires a title param");
      const board = await prisma.board.findFirst({
        where: { id: boardId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      if (!board) throw new Error("Target board not found in this workspace");
      await assertCanWrite(ctx, board.id);
      const ownerRaw = paramString(params, "ownerId", ctx.payload);
      const owner = ownerRaw ? await resolveUser(ctx, ownerRaw) : null;
      const dueInDays = typeof params.dueInDays === "number" && Number.isFinite(params.dueInDays) ? params.dueInDays : null;
      const created = await createBoardItem({
        organizationId: ctx.organizationId,
        boardId: board.id,
        title,
        status: paramString(params, "status", ctx.payload) ?? undefined,
        ownerId: owner?.id,
        priority: paramString(params, "priority", ctx.payload),
        dueAt: dueInDays === null ? null : new Date(Date.now() + dueInDays * 86_400_000),
        actorId: null, // system-generated
      });
      await emitChained(ctx, "task.created", {
        id: created.id,
        boardId: created.boardId,
        title: created.title,
        status: created.status,
        ownerId: created.ownerId,
        assigneeId: created.ownerId,
        priority: created.priority,
        dueAt: created.dueAt,
        createdAt: created.createdAt,
      });
      return { itemId: created.id, boardId: created.boardId, title: created.title };
    },
  },
  {
    key: "create_notification",
    name: "Send an in-app notification",
    category: "Notify",
    description: "Drop a notification into someone's Inbox bell.",
    safeToRetry: true,
    available: true,
    params: [
      { key: "userId", label: "Recipient", type: "user", required: true, help: 'A member, "assignee"/"actor"/"board_owner" from the trigger, or "admins" for every workspace admin' },
      { key: "title", label: "Title", type: "string", required: false },
      { key: "message", label: "Message", type: "text", required: true, help: "Supports {{field}} tokens from the trigger" },
      { key: "link", label: "Link", type: "string", required: false },
    ],
    async execute(ctx, params) {
      const raw = paramString(params, "userId", ctx.payload);
      const message = paramString(params, "message", ctx.payload);
      if (!raw) throw new Error("create_notification requires a userId param");
      if (!message) throw new Error("create_notification requires a message param");
      const fallbackTitle = typeof ctx.payload.title === "string" && ctx.payload.title ? ctx.payload.title : "Automation";
      const link =
        paramString(params, "link", ctx.payload) ??
        (ctx.recordType === "task" && ctx.recordId ? `/item/${ctx.recordId}` : null);
      const title = paramString(params, "title", ctx.payload) ?? fallbackTitle;

      // "admins" fans out to every active workspace admin (idempotent
      // enough for retry: the whole step either wrote or threw before
      // createMany — the only write — so a re-run can't double-insert
      // after success because succeeded steps are never re-run).
      if (raw === "admins" || raw === "org_admins") {
        const admins = await prisma.user.findMany({
          where: {
            organizationId: ctx.organizationId,
            status: "ACTIVE",
            deletedAt: null,
            accessLevel: { in: ["COMPANY_ADMIN", "SUPER_ADMIN"] },
          },
          select: { id: true },
        });
        if (admins.length === 0) throw new Error("No active workspace admins to notify");
        await prisma.notification.createMany({
          data: admins.map((a) => ({ userId: a.id, type: "automation", title, message, link })),
        });
        return { recipients: admins.length, fanOut: "admins" };
      }

      const user = await resolveUser(ctx, raw);
      // Same shape the board comment mention fan-out writes.
      const created = await prisma.notification.create({
        data: {
          userId: user.id,
          type: "automation",
          title,
          message,
          link,
        },
        select: { id: true },
      });
      return { notificationId: created.id, userId: user.id };
    },
  },
  {
    key: "send_email",
    name: "Send an email",
    category: "Notify",
    description: "Email a member through the WorkwrK email queue.",
    safeToRetry: true, // the queue itself dedupe-safe: re-queue only happens when the DB insert failed
    available: true,
    params: [
      { key: "to", label: "To", type: "user", required: true, help: 'A member, "assignee"/"actor", or a raw email address' },
      { key: "subject", label: "Subject", type: "string", required: true },
      { key: "body", label: "Body", type: "text", required: true, help: "Plain text; supports {{field}} tokens" },
    ],
    async execute(ctx, params) {
      const toRaw = paramString(params, "to", ctx.payload);
      const subject = paramString(params, "subject", ctx.payload);
      const body = paramString(params, "body", ctx.payload);
      if (!toRaw) throw new Error("send_email requires a to param");
      if (!subject) throw new Error("send_email requires a subject param");
      if (!body) throw new Error("send_email requires a body param");
      let to = toRaw;
      let userId: string | undefined;
      if (!toRaw.includes("@")) {
        const user = await resolveUser(ctx, toRaw);
        to = user.email;
        userId = user.id;
      }
      const escaped = body
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br/>");
      await queueEmail({
        to,
        subject,
        html: `<p>${escaped}</p>`,
        template: "automation",
        variables: { workflowId: ctx.workflowId, event: ctx.eventKey },
        organizationId: ctx.organizationId,
        userId,
      });
      return { to, subject, queued: true };
    },
  },
  {
    key: "move_to_list",
    name: "Move to a List",
    category: "Tasks",
    description: "Move the task, with its subtasks, to another List. Its status carries over, or maps to the closest one there.",
    safeToRetry: true, // a task already in the target List is left alone
    available: true,
    params: [
      { key: "listId", label: "List", type: "board", required: true },
      { key: "itemId", label: "Task", type: "string", required: false, help: "Defaults to the triggering task" },
    ],
    async execute(ctx, params) {
      const listId = paramString(params, "listId", ctx.payload);
      if (!listId) throw new Error("Pick the List to move the task to");
      const item = await resolveItem(ctx, params);
      if (item.boardId === listId) return { itemId: item.id, boardId: listId, changed: false };
      await assertCanWrite(ctx, item.boardId);
      const [from, to] = await Promise.all([
        prisma.board.findFirst({ where: { id: item.boardId, organizationId: ctx.organizationId }, select: { statuses: true } }),
        prisma.board.findFirst({ where: { id: listId, organizationId: ctx.organizationId, archivedAt: null }, select: { id: true, statuses: true } }),
      ]);
      if (!to) throw new Error("That List no longer exists (deleted, archived or outside this workspace)");
      await assertCanWrite(ctx, to.id);
      const fromStatuses = getBoardStatuses(from);
      const toStatuses = getBoardStatuses(to);
      const remap = remapStatusOnMove({ status: item.status, from: fromStatuses, to: toStatuses });
      await moveBoardItem({ itemId: item.id, toBoardId: to.id, status: remap.status, actorId: null, fromStatuses, toStatuses });
      return { itemId: item.id, fromBoardId: item.boardId, boardId: to.id, status: remap.status, changed: true };
    },
  },
  {
    key: "archive_task",
    name: "Archive the task",
    category: "Tasks",
    description: "Archive the task. It can be restored from the task itself or from Trash.",
    safeToRetry: true, // archiving an archived task changes nothing
    available: true,
    params: [
      { key: "itemId", label: "Task", type: "string", required: false, help: "Defaults to the triggering task" },
    ],
    async execute(ctx, params) {
      const item = await resolveItem(ctx, params);
      if (item.archivedAt) return { itemId: item.id, changed: false };
      await assertCanWrite(ctx, item.boardId);
      await archiveBoardItem(item.id, null);
      return { itemId: item.id, changed: true };
    },
  },
  {
    key: "add_comment",
    name: "Add a comment",
    category: "Tasks",
    description: "Post a comment on the task, written as the person who made this automation.",
    // NOT retry-safe: a re-run after a failure part way could post it twice.
    safeToRetry: false,
    available: true,
    params: [
      { key: "body", label: "Comment", type: "text", required: true, help: "Supports {{field}} tokens from the trigger" },
      { key: "itemId", label: "Task", type: "string", required: false, help: "Defaults to the triggering task" },
    ],
    async execute(ctx, params) {
      const body = paramString(params, "body", ctx.payload);
      if (!body) throw new Error("Write the comment to add");
      if (!ctx.workflowCreatorId) throw new Error("This automation has no creator to post the comment as");
      const item = await resolveItem(ctx, params);
      await assertCanWrite(ctx, item.boardId);
      const author = await prisma.user.findFirst({
        where: { id: ctx.workflowCreatorId, organizationId: ctx.organizationId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!author) throw new Error("The person who made this automation is no longer active, so it cannot post as them");
      const update = await createUpdate({ organizationId: ctx.organizationId, itemId: item.id, authorId: author.id, body });
      return { itemId: item.id, commentId: update.id };
    },
  },
  {
    key: "set_field",
    name: "Set a field",
    category: "Tasks",
    description: "Set one of the List's own fields, or the priority, on the task.",
    safeToRetry: true, // an idempotent state-set
    available: true,
    params: [
      { key: "field", label: "Field", type: "field", required: true },
      { key: "value", label: "Value", type: "string", required: false, help: "Leave it empty to clear the field. Dates take YYYY-MM-DD, today, or +3 for three days from now" },
      { key: "itemId", label: "Task", type: "string", required: false, help: "Defaults to the triggering task" },
    ],
    async execute(ctx, params) {
      const key = paramString(params, "field", ctx.payload);
      if (!key) throw new Error("Pick the field to set");
      const raw = typeof params.value === "string" ? interpolate(params.value, ctx.payload) : params.value;
      const item = await resolveItem(ctx, params);
      await assertCanWrite(ctx, item.boardId);
      if (key === "priority") {
        const p = typeof raw === "string" ? raw.trim().toUpperCase() : "";
        const next = p === "" ? null : p;
        if (next !== null && !["URGENT", "HIGH", "NORMAL", "LOW"].includes(next)) throw new Error(`"${String(raw)}" is not a priority (Urgent, High, Normal or Low)`);
        if (item.priority === next) return { itemId: item.id, field: key, changed: false };
        await updateBoardItem(item.id, { priority: next }, null);
        return { itemId: item.id, field: key, value: next, changed: true };
      }
      const board = await prisma.board.findFirst({ where: { id: item.boardId, organizationId: ctx.organizationId }, select: { schema: true } });
      const def = parseBoardSchema(board?.schema).fields.find((f) => f.key === key);
      if (!def) throw new Error("That field is not on this task's List");
      const choices = def.options?.choices?.map((c) => ({ value: String(c.value), label: String(c.label) }));
      const coerced = coerceSetFieldValue({ key, type: def.type, choices }, raw);
      if (!coerced.ok) throw new Error(coerced.error);
      await updateBoardItem(item.id, {}, null, {
        metadataFn: (stored) => ({ ...stored, [key]: coerced.value }),
      });
      return { itemId: item.id, field: key, value: coerced.value, changed: true };
    },
  },
  {
    key: "send_webhook",
    name: "Send to the webhook",
    category: "Connections",
    description: "POST what happened, signed with the workspace's secret, to the webhook an Owner or Admin connected.",
    // A repeat carries the same delivery id, so the receiver can drop it.
    safeToRetry: true,
    available: true,
    requiresConnection: "WEBHOOK",
    params: [
      { key: "note", label: "Label", type: "string", required: false, help: "Optional. Sent with each delivery, so the receiver can tell your automations apart" },
    ],
    async execute(ctx, params) {
      const { sendThroughWebhook } = await import("./webhook-server");
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(ctx.payload)) if (!k.startsWith("__")) clean[k] = v;
      const delivery = await sendThroughWebhook(ctx.organizationId, ctx.eventKey, {
        event: ctx.eventKey,
        label: paramString(params, "note", ctx.payload),
        automationId: ctx.workflowId,
        runId: ctx.runId,
        record: ctx.recordId ? { type: ctx.recordType, id: ctx.recordId } : null,
        data: clean,
        sentAt: new Date().toISOString(),
      }, `${ctx.runId}:${ctx.workflowId}:${ctx.stepOrder ?? 0}`);
      if (!delivery.ok) throw new Error(delivery.message ?? `The webhook answered ${delivery.httpStatus}`);
      return { httpStatus: delivery.httpStatus, durationMs: delivery.durationMs };
    },
  },
  {
    key: "send_whatsapp",
    name: "Send a WhatsApp message",
    category: "Notify",
    description: "Message a customer or teammate on WhatsApp.",
    safeToRetry: false, // retrying an unconnected channel can never succeed
    available: false, // catalog stub, no send channel yet
    requiresConnection: "WHATSAPP",
    params: [
      { key: "to", label: "To (phone)", type: "string", required: true },
      { key: "message", label: "Message", type: "text", required: true },
    ],
    async execute(ctx) {
      const connection = await prisma.integrationConnection.findUnique({
        where: { organizationId_provider: { organizationId: ctx.organizationId, provider: "WHATSAPP" } },
        select: { status: true },
      });
      if (!connection || connection.status !== "CONNECTED") {
        throw new Error("WhatsApp is not connected for this workspace. Connect it under Automation → Connections.");
      }
      // Honest stub: the connection row exists but the send channel
      // ships in a later wave — fail loudly rather than pretend.
      throw new Error("WhatsApp sending is not available yet.");
    },
  },
];

const ACTION_BY_KEY = new Map(AUTOMATION_ACTIONS.map((a) => [a.key, a] as const));

export function getAction(key: string): AutomationAction | undefined {
  return ACTION_BY_KEY.get(key);
}
