// GET  /api/agents/teammates?q=&removed=1
//   The teammates this person can use, most recent chat first (teammate-
//   thread.ts sortTeammates): every workspace teammate (every agent made
//   before teammates included) and their own private ones, never another
//   person's. Each row carries what waits for them, the unread dot and the
//   chat's last line. Also the plan's limits, whether they may make a
//   workspace teammate, and whether Talk and Tables are on (the tools that
//   need them). `removed=1` adds the removed ones (Show removed).
// POST /api/agents/teammates
//   Make a teammate. A private one: anyone who is a person. A workspace one:
//   the Owner and Admins. Within the plan's limit (TEAMMATE_LIMITS).
//
// docs/plans/ai-teammates.md 4. Every refusal is { error: "<sentence>", code }.

import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { requireApp } from "@/lib/app-gate";
import { prisma } from "@/lib/prisma";
import { waitingCount } from "@/lib/agents/actions";
import { auditAgent } from "@/lib/agents/audit";
import { isTeammateHue } from "@/lib/agents/hues";
import { TEAMMATE_VISIBILITIES, agentUsableWhere, canCreateTeammate, canUseAgent, teammateSlug, type TeammateVisibility } from "@/lib/agents/teammate-access";
import { TEAMMATE_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import {
  TEAMMATE_SELECT,
  invalidRequest,
  overLimit,
  teammateError,
  teammateLimits,
  teammateNotFound,
  teammateRows,
  workspaceModules,
  type TeammateRecord,
} from "@/lib/agents/teammate-server";
import { sortTeammates } from "@/lib/agents/teammate-thread";
import { ALL_TOOL_NAMES, cleanToolNames, editedPersonRules } from "@/lib/agents/teammate-views";
import { sanitizeRules } from "@/lib/agents/tool-policy";

/** The most teammates one list reads. */
const LIST_MAX = 500;

export async function GET(req: Request) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 80);
  const where: Prisma.AgentWhereInput = { organizationId: viewer.organizationId, ...agentUsableWhere(viewer.userId) };
  if (sp.get("removed") !== "1") where.status = { not: "ARCHIVED" };
  if (q) where.AND = [{ OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] }];
  const agents = await prisma.agent.findMany({ where, select: TEAMMATE_SELECT, orderBy: { name: "asc" }, take: LIST_MAX });
  const usable = agents.filter((a) => canUseAgent(a, viewer));

  const [rows, waitingTotal, limits, modules] = await Promise.all([
    teammateRows(usable, viewer),
    waitingCount(viewer.organizationId, viewer.userId),
    teammateLimits(viewer.organizationId, viewer.userId),
    workspaceModules(viewer.organizationId),
  ]);
  return NextResponse.json({
    teammates: sortTeammates(rows),
    waitingTotal,
    // TODO(templates): the six starter cards (src/lib/agents/templates.ts, spec section 6).
    templates: [],
    canCreateWorkspace: canCreateTeammate(viewer, "WORKSPACE") === "ok",
    limits: { personal: limits.personal, workspace: limits.workspace },
    talkOn: modules.talkOn,
    tablesOn: modules.tablesOn,
  });
}

const rulesSchema = z.record(z.string().max(120), z.enum(["ask", "always"]));

const createSchema = z.object({
  // TODO(templates): only a key of TEAMMATE_TEMPLATES (src/lib/agents/templates.ts) once it exists.
  template: z.string().trim().min(1).max(60).nullable().optional(),
  name: z.string().trim().min(1).max(60),
  hue: z.string().refine(isTeammateHue),
  avatar: z.string().trim().max(40).regex(/^[A-Za-z][A-Za-z0-9]*$/).nullable().optional(),
  job: z.string().trim().min(1).max(200),
  instructions: z.string().max(8000).default(""),
  toolNames: z.array(z.string().max(64)).max(100),
  visibility: z.enum(TEAMMATE_VISIBILITIES),
  personRules: rulesSchema.optional(),
  agentRules: rulesSchema.optional(),
});

/** How many slugs a new teammate tries before it gives up. */
const SLUG_TRIES = 5;

/**
 * A free slug for a new teammate (teammate-access.ts teammateSlug): a private
 * one carries a random suffix; a workspace one is its name, bumped -2, -3 on
 * a clash, as a custom agent's is (POST /api/agents).
 */
async function freeSlug(organizationId: string, name: string, visibility: TeammateVisibility): Promise<string> {
  const base = teammateSlug(name, visibility);
  if (visibility === "PRIVATE") return base;
  let slug = base;
  for (let i = 2; i < 50; i += 1) {
    const clash = await prisma.agent.findFirst({ where: { organizationId, slug }, select: { id: true } });
    if (!clash) return slug;
    slug = `${base}-${i}`;
  }
  return teammateSlug(name, "PRIVATE");
}

function isUniqueClash(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

export async function POST(req: Request) {
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const { viewer } = gate;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidRequest();
  const b = parsed.data;

  const may = canCreateTeammate(viewer, b.visibility);
  // requireApp answers a Guest 404 before this; the same answer if one gets here.
  if (may === "guest") return teammateNotFound();
  if (may === "agent_account") return teammateError(403, "agent_account", TEAMMATE_ROUTE_ERRORS.agentAccount);
  if (may === "needs_admin") return teammateError(403, "needs_admin", TEAMMATE_ROUTE_ERRORS.needsAdmin);
  const over = overLimit(await teammateLimits(viewer.organizationId, viewer.userId), b.visibility);
  if (over) return over;

  // A new teammate always names its tools (never the legacy set), and its
  // rules keep only what each level may say: managers only tighten, and a
  // "Don't ask" for one conversation or for calls for other people only
  // ever comes from an approval card.
  const toolNames = cleanToolNames(b.toolNames);
  const agentRules = sanitizeRules(b.agentRules ?? {}, { level: "agent", allowedTools: ALL_TOOL_NAMES });
  const personRules = editedPersonRules({}, b.personRules ?? {});

  let agent: TeammateRecord | null = null;
  for (let attempt = 0; attempt < SLUG_TRIES && !agent; attempt += 1) {
    try {
      agent = await prisma.agent.create({
        data: {
          organizationId: viewer.organizationId,
          slug: await freeSlug(viewer.organizationId, b.name, b.visibility),
          name: b.name,
          description: b.job,
          systemPrompt: b.instructions.trim(),
          avatar: b.avatar ?? null,
          hue: b.hue,
          visibility: b.visibility,
          ownerId: b.visibility === "PRIVATE" ? viewer.userId : null,
          approvalRules: agentRules,
          template: b.template ?? null,
          toolNames,
          isPrebuilt: false,
          createdById: viewer.userId,
        },
        select: TEAMMATE_SELECT,
      });
    } catch (err) {
      // Two teammates of one name at once: the next try finds the other's slug.
      if (!isUniqueClash(err) || attempt === SLUG_TRIES - 1) throw err;
    }
  }
  if (!agent) throw new Error("teammate not created");

  if (Object.keys(personRules).length > 0) {
    await prisma.agentPersonSetting.create({ data: { agentId: agent.id, userId: viewer.userId, approvalRules: personRules } });
  }
  await auditAgent({
    organizationId: viewer.organizationId,
    actorId: viewer.userId,
    agent,
    action: "added",
    metadata: { visibility: agent.visibility, template: agent.template, toolNames },
  });
  const [teammate] = await teammateRows([agent], viewer);
  return NextResponse.json({ teammate }, { status: 201 });
}
