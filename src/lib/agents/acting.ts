// The person an AI teammate acts as (docs/plans/ai-teammates.md 3.2).
//
// A teammate is never a principal. Every tool call runs as ONE person: the
// signed-in person whose teammate chat it is, the person a routine works for
// (AgentRoutine.actingForId, never a fallback), or the person an approval
// belongs to (AgentAction.actingForId, never an Admin deciding for them).
// This file answers who that person is right now, and refuses when the
// person is not someone a teammate may act for.
//
// THE RULES are creatorState's (src/lib/talk-updates-server.ts), the gate a
// scheduled Talk update already stands behind: a user row in this workspace
// that is not deleted and not INACTIVE, a Viewer the engine can build, not a
// Guest, not an agent account, and the AI app open to them. The routine
// runner and every approval call resolveActingPerson first; the chat route
// gets the same guarantees from requireApp("ai").
//
// THE ONE PLACE A TEAMMATE READS THE LEGACY LEVEL. The write paths and gates
// a teammate goes through (gateItem, patchItemAs, postItemCommentAs,
// saveDocAs, the List helpers, the permission matrix, the Inbox's
// readability) still take the person's access level: the access engine
// stays inert for them until access step 6. So the level is read here, once
// per person, and handed to them through the small wrappers at the end, on
// the item-gate precedent (eslint-access-allowlist.mjs): the other teammate
// files never read it themselves.
//
// LIMITATION, stated so nobody relies on the opposite: viewerForUser (and
// the legacy tools' callerLevel in tools.ts) need the person ANCHORED in the
// workspace (User.organizationId), so a person who works here through a
// second membership is "gone" for a teammate exactly as they already are for
// Ask AI tools and Talk updates. The follow-up is to read the level with
// levelHeldIn everywhere, callerLevel included.
//
// Server-only: imports prisma.

import type { AccessLevel } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/access";
import { levelHeldIn } from "@/lib/access/acting-workspace";
import { legacyIsManagerLevel } from "@/lib/access/legacy-levels";
import { nodeCtxFromLevel, type NodeCtx } from "@/lib/access/node-rules";
import type { OrgRole, Viewer } from "@/lib/access/types";
import { viewerForUser } from "@/lib/access/viewer";
import { goalRightsActor } from "@/lib/alignment-scope";
import { hasPermission } from "@/lib/api-helpers";
import { canContributeBoard, getBoardForReader } from "@/lib/board";
import type { ItemCtx } from "@/lib/item-gate";
import { readableTargets, type TargetVerdict } from "@/lib/notification-readability";
import type { NotificationTarget } from "@/lib/notification-target";
import type { PermissionModule } from "@/lib/permissions";
import { getEffectivePreferences } from "@/lib/preferences";
import { isValidTimeZone } from "@/lib/reports/schedule";
import { readOrgWorkSchedule } from "@/lib/work-schedule-server";
import { agentForPerson } from "./teammate-copy";
import type { TeammateToolContext, ToolContext } from "./tools";

export interface ActingPerson {
  userId: string;
  organizationId: string;
  /** The level held in this workspace now (levelHeldIn). Read only through the wrappers below. */
  accessLevel: AccessLevel;
  orgRole: OrgRole;
  /** "Priya Shah", else the email. */
  name: string;
  /** "Priya", else the name. */
  firstName: string;
  email: string;
  /** prefs.home.locale.timezone, else the workspace's working calendar, else "UTC". */
  timezone: string;
  /** viewerForUser(organizationId, userId), hydrated. */
  viewer: Viewer;
}

/** Why a teammate may not act for this person now. */
export type ActingRefusal = "gone" | "inactive" | "guest" | "agent_account" | "ai_off";

export type ActingResult = { ok: true; person: ActingPerson } | { ok: false; reason: ActingRefusal };

/**
 * The zone the person's dates are written in: their own, else the
 * workspace's, else UTC. Also the teammate routes' zone for a routine's
 * words and for a schedule the person picks.
 */
export async function personZone(userId: string, organizationId: string): Promise<string> {
  const prefs = await getEffectivePreferences(userId, organizationId).catch(() => null);
  const own = prefs?.home?.locale?.timezone;
  if (own && isValidTimeZone(own)) return own;
  const org = await readOrgWorkSchedule(organizationId);
  if (org.timezone && isValidTimeZone(org.timezone)) return org.timezone;
  return "UTC";
}

/**
 * The person a teammate acts as, read fresh, or why it may not act for them.
 * Called at the start of every routine run and every approval, so a person
 * who left, was deactivated, became a Guest or lost AI stops their teammates
 * at the next thing those teammates would have done.
 */
export async function resolveActingPerson(organizationId: string, userId: string): Promise<ActingResult> {
  const row = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true, organizationId: true, accessLevel: true, status: true, deletedAt: true, firstName: true, lastName: true, email: true },
  });
  if (!row || row.deletedAt) return { ok: false, reason: "gone" };
  if (row.status === "INACTIVE") return { ok: false, reason: "inactive" };
  const viewer = await viewerForUser(organizationId, userId);
  if (!viewer) return { ok: false, reason: "gone" };
  if (viewer.orgRole === "GUEST") return { ok: false, reason: "guest" };
  if (viewer.isAgent) return { ok: false, reason: "agent_account" };
  const ai = await can(viewer, "view", { type: "app", key: "ai" });
  if (!ai.allowed) return { ok: false, reason: "ai_off" };
  const accessLevel = await levelHeldIn(userId, organizationId, { organizationId: row.organizationId, accessLevel: row.accessLevel });
  if (!accessLevel) return { ok: false, reason: "gone" };
  const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.email;
  return {
    ok: true,
    person: {
      userId: row.id,
      organizationId,
      accessLevel,
      orgRole: viewer.orgRole,
      name,
      firstName: (row.firstName ?? "").trim() || name,
      email: row.email,
      timezone: await personZone(userId, organizationId),
      viewer,
    },
  };
}

/** Each tool context's person, so the calls of one turn or one approval resolve them once. */
const PERSON_OF = new WeakMap<ToolContext, ActingPerson>();

/**
 * The context a tool runs with when a teammate acts for this person. The
 * person rides along (PERSON_OF), resolved by the caller a moment before;
 * every gate the tools call still reads the object's own rights fresh.
 */
export function toolCtxFor(
  person: ActingPerson,
  teammate: Omit<TeammateToolContext, "timezone"> & { timezone?: string },
): ToolContext {
  const ctx: ToolContext = {
    orgId: person.organizationId,
    userId: person.userId,
    teammate: { ...teammate, timezone: teammate.timezone || person.timezone },
  };
  PERSON_OF.set(ctx, person);
  return ctx;
}

/**
 * The person a tool call acts for: the one toolCtxFor carried, else read
 * fresh by the same rules. Null when a teammate may not act for them.
 */
export async function actingPersonFor(ctx: ToolContext): Promise<ActingPerson | null> {
  const carried = PERSON_OF.get(ctx);
  if (carried && carried.userId === ctx.userId && carried.organizationId === ctx.orgId) return carried;
  const r = await resolveActingPerson(ctx.orgId, ctx.userId);
  return r.ok ? r.person : null;
}

/** The audit row's actorLabel: "Chief of Staff for Priya Shah". */
export function actorLabelFor(agent: { name: string }, person: Pick<ActingPerson, "name">): string {
  return agentForPerson(agent.name, person.name);
}

// ── The legacy gates, for the person (see the file header) ──────────

/** The person as the item routes see a signed-in caller (gateItem, patchItemAs, postItemCommentAs). */
export function itemCtxFor(person: ActingPerson): ItemCtx {
  return { userId: person.userId, accessLevel: person.accessLevel, organizationId: person.organizationId, userName: person.name };
}

/** The person for the one node resolver (docAccess). */
export function nodeCtxOf(person: ActingPerson): NodeCtx {
  return nodeCtxFromLevel(person.userId, person.organizationId, person.accessLevel);
}

/** The person as saveDocAs takes its caller. */
export function docSaveCtxOf(person: ActingPerson): { userId: string; orgId: string; accessLevel: string } {
  return { userId: person.userId, orgId: person.organizationId, accessLevel: person.accessLevel };
}

/** Can view or higher on the List (getBoardForReader, the read PATCH asks of a move's target). */
export async function canReadListAs(person: ActingPerson, boardId: string): Promise<boolean> {
  return (await getBoardForReader(boardId, person.userId, person.accessLevel)) !== null;
}

/** Can edit on the List (canContributeBoard, PATCH's check on both Lists of a move). */
export async function canContributeAs(person: ActingPerson, boardId: string): Promise<boolean> {
  return canContributeBoard(boardId, person.userId, person.accessLevel);
}

/** The person as a session, for the permission matrix and the goal rules. */
function sessionOf(person: ActingPerson) {
  return { user: { id: person.userId, organizationId: person.organizationId, accessLevel: person.accessLevel } };
}

/** The permission matrix's cell for the person, as the route checks it (hasPermission). */
export async function personMay(person: ActingPerson, module: PermissionModule, action: string): Promise<boolean> {
  return hasPermission(sessionOf(person), module, action);
}

/** The manager tier the legacy tools read (create_okr, create_workspace). */
export function isManagerPerson(person: ActingPerson): boolean {
  return legacyIsManagerLevel(person.accessLevel);
}

/** The goal rules' actor for the person (mayEditGoal), as create_okr builds it. */
export async function goalActorFor(person: ActingPerson): Promise<Awaited<ReturnType<typeof goalRightsActor>>> {
  return goalRightsActor(sessionOf(person));
}

/** What this person can open in this workspace, of the Inbox's targets (readableTargets). */
export async function readableTargetsFor(person: ActingPerson, targets: readonly NotificationTarget[]): Promise<Map<string, TargetVerdict>> {
  return readableTargets(person.userId, person.organizationId, targets, person.accessLevel);
}
