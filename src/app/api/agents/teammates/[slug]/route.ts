// GET    /api/agents/teammates/[slug]: one teammate's settings, for anyone who
//        can use it (its instructions read-only for whoever cannot manage it).
// PATCH  /api/agents/teammates/[slug]: change it, pause it or turn it on, or
//        add a removed one back (`restore`). Its managers only: the Owner and
//        Admins for a workspace teammate, its owner alone for a private one.
//        Its tools change by one tick (`toolChanges`) or a whole list
//        (`toolNames`), read and written under a lock on its row (toolsAfter).
// DELETE /api/agents/teammates/[slug]: remove it. It goes to ARCHIVED (its
//        chats, memories and activity are kept), what it asked that still
//        waits is cancelled, and every routine with it pauses (agent_removed).
//
// docs/plans/ai-teammates.md 4. Another person's private teammate is the same
// 404 as a missing one on every method. Every refusal is { error, code }.

import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { cancelPendingActionsOf } from "@/lib/agents/actions";
import { auditAgent, type AgentAuditAction } from "@/lib/agents/audit";
import { computeNextRunAt } from "@/lib/agents/autonomous";
import { isTeammateHue } from "@/lib/agents/hues";
import { pauseRoutine } from "@/lib/agents/routines-server";
import { canManageAgent } from "@/lib/agents/teammate-access";
import { removedComposer } from "@/lib/agents/teammate-copy";
import {
  TEAMMATE_SELECT,
  invalidRequest,
  loadTeammate,
  notManager,
  overLimit,
  teammateDetail,
  teammateError,
  teammateLimits,
  teammateNotFound,
  workspaceModules,
  type TeammateRecord,
  type WorkspaceModules,
} from "@/lib/agents/teammate-server";
import { teammateToolNames } from "@/lib/agents/teammate-tools";
import { ALL_TOOL_NAMES, TOOL_CONNECTOR, TOOL_MODULE, cleanToolNames, sameRules } from "@/lib/agents/teammate-views";
import { sanitizeRules } from "@/lib/agents/tool-policy";
import { isConnectorToolName, isToolName, type ToolName } from "@/lib/agents/tool-names";
import { parseProducts, type ConnectorProduct, type ProductSet } from "@/lib/connectors/products";

/** Every Google product: what the stored set holds, whatever is on here (the keep below reads it). */
const EVERY_PRODUCT: ProductSet = { gmail: true, calendar: true };

/**
 * A change to the tools: one tick of the tools tab (`changes`, the tools it
 * adds and removes), or a whole list (`list`, the form every page before the
 * review of step 5 sends, with the Google products whose rows it showed).
 */
type ToolsEdit =
  | { kind: "changes"; add: readonly string[]; remove: readonly string[] }
  | { kind: "list"; names: readonly string[]; shown: readonly ConnectorProduct[] };

/**
 * The tools after an edit, from the stored row as read under its lock.
 *
 * A tool whose module is off in this workspace keeps what is stored for it,
 * either way. The tools tab cannot show it on or off (its row is disabled,
 * and the detail's tool set leaves it out while the module is off), so a
 * save made then must neither drop it nor add it: Talk turned back on brings
 * back the Talk tools its managers chose. Unknown and excluded names are
 * dropped (cleanToolNames).
 *
 * A CHANGE (review of step 5) touches only the tools it names, in the list
 * stored now: two saves at once both land, and a tab read before another's
 * change can change only the tool it ticked. Its Google tool is its
 * managers' word on that tool's row, a removal included, whatever the switch
 * says now. Remove wins over add for a tool named in both.
 *
 * A WHOLE LIST takes a Google tool by whether the tab SHOWED its product's
 * rows (`shown`), never by whether the product is on now
 * (docs/plans/ai-teammates-phase3.md step 5, and the item the review of step
 * 1 handed to it). Worst case of deciding by "on now": a tab read while
 * Gmail was off, or a page older than the Google rows, saved after Gmail came
 * on, drops every stored Gmail tool nobody was shown; and a Gmail tool its
 * manager unticked on its row, saved just after Gmail was turned off, would
 * be kept and come back when Gmail does. So for a product whose rows the tab
 * showed, the list is its managers' word, a removal included, whatever the
 * switch says now; for any other, what is stored stays, neither dropped nor
 * added. A request that names no product keeps every stored Google tool.
 */
function toolsAfter(stored: { toolNames: unknown; productSlug: string | null }, edit: ToolsEdit, modules: WorkspaceModules): ToolName[] {
  const off = (n: ToolName) => (TOOL_MODULE[n] === "talk" && !modules.talkOn) || (TOOL_MODULE[n] === "tables" && !modules.tablesOn);
  // What is stored now, as a teammate may hold it (the legacy set for an agent made before teammates).
  const now = teammateToolNames(stored, { tablesOn: true, talkOn: true, connectors: EVERY_PRODUCT });
  if (edit.kind === "changes") {
    const next = new Set<ToolName>(now);
    for (const n of edit.add) if (isToolName(n) && !off(n)) next.add(n);
    for (const n of edit.remove) if (isToolName(n) && !off(n)) next.delete(n);
    return cleanToolNames([...next]);
  }
  const shown = new Set(edit.shown);
  const unshown = (n: ToolName) => isConnectorToolName(n) && !shown.has(TOOL_CONNECTOR[n]);
  const keep = (n: ToolName) => off(n) || unshown(n);
  const kept = now.filter(keep);
  return cleanToolNames([...edit.names.filter((n) => !(isToolName(n) && keep(n))), ...kept]);
}

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { slug } = await params;
  const agent = await loadTeammate(slug, gate.viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();
  return NextResponse.json({ teammate: await teammateDetail(agent, gate.viewer), canManage: canManageAgent(agent, gate.viewer) });
}

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    hue: z.string().refine(isTeammateHue).nullable().optional(),
    avatar: z.string().trim().max(40).regex(/^[A-Za-z][A-Za-z0-9]*$/).nullable().optional(),
    job: z.string().trim().min(1).max(200).optional(),
    instructions: z.string().max(8000).optional(),
    // The whole list: what older pages and API clients send.
    toolNames: z.array(z.string().max(64)).max(100).optional(),
    // With a whole list, the Google products whose rows the page showed: only
    // for those does `toolNames` say what is ticked.
    connectorRows: z.array(z.string().max(20)).max(10).optional(),
    // One tick of the tools tab (teammate-setup.ts toolsPatch, review of step
    // 5): the tools it adds and removes, applied to the list stored now.
    toolChanges: z
      .object({ add: z.array(z.string().max(64)).max(100).optional(), remove: z.array(z.string().max(64)).max(100).optional() })
      .strict()
      .optional(),
    agentRules: z.record(z.string().max(120), z.enum(["ask", "always"])).optional(),
    status: z.enum(["ENABLED", "DISABLED"]).optional(),
    monthlyQuestionCap: z.number().int().min(1).max(100_000).nullable().optional(),
    restore: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0)
  // A whole list and a change at once say two things about the same tools.
  .refine((v) => v.toolNames === undefined || v.toolChanges === undefined);

function sameList(next: readonly string[], stored: unknown): boolean {
  return Array.isArray(stored) && stored.length === next.length && next.every((n, i) => stored[i] === n);
}

export async function PATCH(req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { slug } = await params;
  const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();
  if (!canManageAgent(agent, viewer)) return notManager();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  const b = parsed.data;

  const removed = agent.status === "ARCHIVED";
  if (removed && !b.restore) return teammateError(409, "agent_removed", removedComposer(agent.name));
  // Adding one back counts toward the plan's limit again, as making it did
  // (an agent the workspace had before teammates never counts).
  if (removed && (agent.visibility === "PRIVATE" || agent.toolNames !== null)) {
    const over = overLimit(await teammateLimits(viewer.organizationId, viewer.userId), agent.visibility === "PRIVATE" ? "PRIVATE" : "WORKSPACE");
    if (over) return over;
  }

  const data: Prisma.AgentUpdateInput = {};
  const edited: string[] = [];
  if (b.name !== undefined && b.name !== agent.name) {
    data.name = b.name;
    edited.push("name");
  }
  if (b.job !== undefined && b.job !== agent.description) {
    data.description = b.job;
    edited.push("job");
  }
  if (b.instructions !== undefined && b.instructions.trim() !== agent.systemPrompt) {
    data.systemPrompt = b.instructions.trim();
    edited.push("instructions");
  }
  if (b.hue !== undefined && b.hue !== agent.hue) {
    data.hue = b.hue;
    edited.push("hue");
  }
  if (b.avatar !== undefined && b.avatar !== agent.avatar) {
    data.avatar = b.avatar;
    edited.push("avatar");
  }
  let scheduleStopped = false;
  // The tools (toolsAfter), decided below under a lock on the teammate's row.
  const toolsEdit: ToolsEdit | null =
    b.toolChanges !== undefined
      ? { kind: "changes", add: b.toolChanges.add ?? [], remove: b.toolChanges.remove ?? [] }
      : b.toolNames !== undefined
        ? { kind: "list", names: b.toolNames, shown: parseProducts(b.connectorRows ?? []) }
        : null;
  const modules = toolsEdit ? await workspaceModules(agent.organizationId) : null;
  if (b.monthlyQuestionCap !== undefined && b.monthlyQuestionCap !== agent.monthlyQuestionCap) {
    data.monthlyQuestionCap = b.monthlyQuestionCap;
    edited.push("monthlyQuestionCap");
  }
  let rulesChanged = false;
  if (b.agentRules !== undefined) {
    // Managers only tighten: what survives is "ask" for a whole tool.
    const next = sanitizeRules(b.agentRules, { level: "agent", allowedTools: ALL_TOOL_NAMES });
    if (!sameRules(next, sanitizeRules(agent.approvalRules, { level: "agent", allowedTools: ALL_TOOL_NAMES }))) {
      data.approvalRules = next;
      rulesChanged = true;
    }
  }
  const status = removed ? (b.status ?? "ENABLED") : b.status;
  const statusChanged = status !== undefined && status !== agent.status;
  /** The status, once the tools are decided: a first choice of tools stops an old schedule, which turning on must not restart. */
  const applyStatus = () => {
    if (!statusChanged) return;
    data.status = status;
    // An agent that also runs on its own schedule (an agent made before
    // teammates): paused, it never fires; turned on or added back, its next
    // slot counts from now. Left null, run-due-agents reads "never run" and
    // fires it on the next tick.
    if (status === "DISABLED") data.nextRunAt = null;
    else if (agent.autonomousEnabled && agent.scheduleCron && !scheduleStopped) data.nextRunAt = computeNextRunAt(agent.scheduleCron);
  };

  let updated: TeammateRecord = agent;
  if (toolsEdit && modules) {
    // ONE WRITE, UNDER A LOCK ON THE ROW (review of step 5). The stored tools
    // are read FOR UPDATE inside the transaction that writes them, so a second
    // save at the same moment waits here, then reads what this one wrote.
    // Before, the tools were read before the request and written after it with
    // no compare: two saves at once could undo each other, a save that named
    // no product putting back a Gmail tool a Gmail row's save had just
    // removed. A list is always stored: an agent the workspace had before
    // teammates keeps the legacy set only until its tools are chosen here.
    const written = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ toolNames: unknown; productSlug: string | null }>>`
        SELECT "toolNames", "productSlug" FROM "Agent" WHERE "id" = ${agent.id} FOR UPDATE`;
      const stored = rows[0];
      if (!stored) return null;
      const next = toolsAfter(stored, toolsEdit, modules);
      if (!sameList(next, stored.toolNames)) {
        data.toolNames = next;
        edited.push("tools");
        // An agent made before teammates has its tools chosen here for the
        // first time: it is a teammate from now on, which the old loop never
        // runs (legacy-agents.ts), so its Workspace agents schedule stops here,
        // in the open, and its routines take over. Before, it stopped silently
        // and Workspace agents offered the catalog agent again (review round 2).
        if (stored.toolNames === null && agent.autonomousEnabled) {
          data.autonomousEnabled = false;
          data.nextRunAt = null;
          edited.push("schedule");
          scheduleStopped = true;
        }
      }
      applyStatus();
      return Object.keys(data).length > 0 ? tx.agent.update({ where: { id: agent.id }, data, select: TEAMMATE_SELECT }) : agent;
    });
    if (!written) return teammateNotFound();
    updated = written;
  } else {
    applyStatus();
    if (Object.keys(data).length > 0) updated = await prisma.agent.update({ where: { id: agent.id }, data, select: TEAMMATE_SELECT });
  }

  const audits: Array<{ action: AgentAuditAction; metadata?: Record<string, unknown> }> = [];
  if (statusChanged) audits.push(removed ? { action: "added", metadata: { restored: true } } : { action: status === "ENABLED" ? "turned_on" : "paused" });
  if (edited.length > 0) audits.push({ action: "edited", metadata: { fields: edited } });
  if (rulesChanged) audits.push({ action: "approvals_changed", metadata: { scope: "agent" } });
  for (const a of audits) await auditAgent({ organizationId: viewer.organizationId, actorId: viewer.userId, agent: updated, ...a });

  return NextResponse.json({ teammate: await teammateDetail(updated, viewer), canManage: true, ...(scheduleStopped ? { scheduleStopped: true } : {}) });
}

export async function DELETE(_req: Request, { params }: Params) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const { slug } = await params;
  const agent = await loadTeammate(slug, viewer, { includeRemoved: true });
  if (!agent) return teammateNotFound();
  if (!canManageAgent(agent, viewer)) return notManager();
  // Removed already (a second click): nothing more to do.
  if (agent.status === "ARCHIVED") return NextResponse.json({ ok: true });

  const now = new Date();
  // First, so no new turn, approval or routine run starts with it.
  await prisma.agent.update({ where: { id: agent.id }, data: { status: "ARCHIVED", autonomousEnabled: false, nextRunAt: null } });
  await cancelPendingActionsOf(agent, now);
  const routines = await prisma.agentRoutine.findMany({
    where: { agentId: agent.id, status: "active" },
    select: { id: true, organizationId: true, agentId: true, actingForId: true, name: true },
  });
  for (const r of routines) await pauseRoutine(r, "agent_removed");
  await auditAgent({ organizationId: viewer.organizationId, actorId: viewer.userId, agent, action: "removed" });
  return NextResponse.json({ ok: true });
}
