// GET    /api/agents/teammates/[slug]: one teammate's settings, for anyone who
//        can use it (its instructions read-only for whoever cannot manage it).
// PATCH  /api/agents/teammates/[slug]: change it, pause it or turn it on, or
//        add a removed one back (`restore`). Its managers only: the Owner and
//        Admins for a workspace teammate, its owner alone for a private one.
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
} from "@/lib/agents/teammate-server";
import { teammateToolNames } from "@/lib/agents/teammate-tools";
import { ALL_TOOL_NAMES, TOOL_MODULE, cleanToolNames, sameRules } from "@/lib/agents/teammate-views";
import { sanitizeRules } from "@/lib/agents/tool-policy";
import { isToolName, type ToolName } from "@/lib/agents/tool-names";
import { NO_PRODUCTS } from "@/lib/connectors/products";

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
    toolNames: z.array(z.string().max(64)).max(100).optional(),
    agentRules: z.record(z.string().max(120), z.enum(["ask", "always"])).optional(),
    status: z.enum(["ENABLED", "DISABLED"]).optional(),
    monthlyQuestionCap: z.number().int().min(1).max(100_000).nullable().optional(),
    restore: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0);

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
  if (b.toolNames !== undefined) {
    // A list is always stored: an agent the workspace had before teammates
    // keeps the legacy set only until its tools are chosen here.
    //
    // A tool whose module is off in this workspace keeps what is stored for
    // it. The tools tab cannot show it on or off (its row is disabled, and
    // the detail's tool set leaves it out while the module is off), so a save
    // made then must neither drop it nor add it: Talk turned back on brings
    // back the Talk tools its managers chose.
    const modules = await workspaceModules(agent.organizationId);
    const off = (n: ToolName) => (TOOL_MODULE[n] === "talk" && !modules.talkOn) || (TOOL_MODULE[n] === "tables" && !modules.tablesOn);
    const kept = teammateToolNames(agent, { tablesOn: true, talkOn: true, connectors: NO_PRODUCTS }).filter(off);
    const next = cleanToolNames([...b.toolNames.filter((n) => !(isToolName(n) && off(n))), ...kept]);
    if (!sameList(next, agent.toolNames)) {
      data.toolNames = next;
      edited.push("tools");
      // An agent made before teammates has its tools chosen here for the
      // first time: it is a teammate from now on, which the old loop never
      // runs (legacy-agents.ts), so its Workspace agents schedule stops here,
      // in the open, and its routines take over. Before, it stopped silently
      // and Workspace agents offered the catalog agent again (review round 2).
      if (agent.toolNames === null && agent.autonomousEnabled) {
        data.autonomousEnabled = false;
        data.nextRunAt = null;
        edited.push("schedule");
        scheduleStopped = true;
      }
    }
  }
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
  if (statusChanged) {
    data.status = status;
    // An agent that also runs on its own schedule (an agent made before
    // teammates): paused, it never fires; turned on or added back, its next
    // slot counts from now. Left null, run-due-agents reads "never run" and
    // fires it on the next tick.
    if (status === "DISABLED") data.nextRunAt = null;
    else if (agent.autonomousEnabled && agent.scheduleCron && !scheduleStopped) data.nextRunAt = computeNextRunAt(agent.scheduleCron);
  }

  const updated = Object.keys(data).length > 0 ? await prisma.agent.update({ where: { id: agent.id }, data, select: TEAMMATE_SELECT }) : agent;

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
