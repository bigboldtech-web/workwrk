// Who may use, manage and create an AI teammate (docs/plans/ai-teammates.md
// 3.1 and 4). The pure half, so the teammate routes, the routine runner, the
// Ask AI guard and the tests read one rule. loadTeammate (a row by slug,
// through these rules) comes with the teammate routes.
//
// USING. A WORKSPACE teammate, which is every agent made before the
// visibility column, is for every member with the AI app, exactly as before.
// A PRIVATE one is its owner's alone. A Guest and an agent account use none:
// a teammate acts as the person using it, and neither is a person it can act
// for (resolveActingPerson refuses both). The AI app gate itself
// (requireApp("ai")) stays the route's job.
//
// MANAGING. A WORKSPACE teammate is managed by the Owner and Admins, as
// agents are today. A PRIVATE one is managed by its owner and nobody else,
// an Admin included: its instructions decide what it does in the owner's
// name, and an Admin who could rewrite them could act as the owner.
//
// Status is in neither rule. A paused or removed teammate is still one its
// people can open, to read the chat or to turn it back on; the routes refuse
// a turn on anything but ENABLED.
//
// Pure: type imports, and the catalog constant (no imports of its own).

import type { Prisma } from "@/generated/prisma";
import type { Viewer } from "@/lib/access/types";
import { AGENTS_BY_SLUG } from "./catalog";

export const TEAMMATE_VISIBILITIES = ["PRIVATE", "WORKSPACE"] as const;

export type TeammateVisibility = (typeof TEAMMATE_VISIBILITIES)[number];

/** The Agent columns the rules read. */
export interface TeammateAccessRow {
  organizationId: string;
  visibility: string | null;
  ownerId: string | null;
}

/** The Viewer fields the rules read (a full Viewer passes). */
export type TeammateViewer = Pick<Viewer, "userId" | "organizationId" | "orgRole" | "isAgent"> &
  Partial<Pick<Viewer, "status" | "deleted">>;

/** A live person a teammate can act for: not a Guest, not an agent account, not gone. */
function isPerson(v: TeammateViewer): boolean {
  return !v.isAgent && v.orgRole !== "GUEST" && v.deleted !== true && v.status !== "INACTIVE";
}

function ownedBy(agent: TeammateAccessRow, v: TeammateViewer): boolean {
  return agent.ownerId !== null && agent.ownerId === v.userId;
}

/**
 * Whether this person may chat with the teammate, run its routines and
 * decide its approvals. A visibility this code does not know reads as
 * PRIVATE: a teammate is never shared by mistake.
 */
export function canUseAgent(agent: TeammateAccessRow, viewer: TeammateViewer): boolean {
  if (agent.organizationId !== viewer.organizationId || !isPerson(viewer)) return false;
  if (agent.visibility === "WORKSPACE") return true;
  return ownedBy(agent, viewer);
}

/** Whether this person may change the teammate's instructions, tools, limits and status, or remove it. */
export function canManageAgent(agent: TeammateAccessRow, viewer: TeammateViewer): boolean {
  if (agent.organizationId !== viewer.organizationId || !isPerson(viewer)) return false;
  if (agent.visibility === "WORKSPACE") return viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
  return ownedBy(agent, viewer);
}

/**
 * canUseAgent's visibility half as a query: the agents this person may use,
 * once the route has checked the AI app. It is an `OR`, so spread it into a
 * where that has no OR of its own, or put it inside an AND.
 */
export function agentUsableWhere(userId: string): Prisma.AgentWhereInput {
  return { OR: [{ visibility: "WORKSPACE" }, { ownerId: userId }] };
}

export type CreateTeammateRefusal = "guest" | "agent_account" | "needs_admin";

/**
 * Whether this person may make a teammate of this visibility: anyone who is a
 * person may make their own; only the Owner and Admins may make one for the
 * whole workspace. The plan's limit is the route's (TEAMMATE_LIMITS).
 */
export function canCreateTeammate(viewer: TeammateViewer, visibility: TeammateVisibility): "ok" | CreateTeammateRefusal {
  if (viewer.isAgent) return "agent_account";
  if (viewer.orgRole === "GUEST") return "guest";
  if (visibility === "WORKSPACE" && viewer.orgRole !== "OWNER" && viewer.orgRole !== "ADMIN") return "needs_admin";
  return "ok";
}

/**
 * Slugs no agent may have: each is a static segment beside
 * /api/agents/[slug] (runs, and the teammate routes), and Next serves the
 * static route first, so an agent with one of these slugs could never be
 * reached by it.
 */
export const RESERVED_AGENT_SLUGS = ["runs", "teammates", "actions", "memories", "routines"] as const;

const RESERVED: ReadonlySet<string> = new Set(RESERVED_AGENT_SLUGS);

export function isReservedAgentSlug(slug: string): boolean {
  return RESERVED.has(slug);
}

const SLUG_NAME_MAX = 40;
const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** "Weekly reporter" as "weekly-reporter", spelled the way POST /api/agents spells a custom agent's slug. */
function slugPart(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, SLUG_NAME_MAX).replace(/-+$/, "") || "teammate";
}

function randomSuffix(length = 6): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length];
  return out;
}

/**
 * A new teammate's slug. A PRIVATE one is `t-<name>-<6 random>`: slugs are
 * unique per workspace, and two people who each make a "Chief of Staff" must
 * not collide (nor learn of each other from the clash). A WORKSPACE one is
 * the name, as for a custom agent, and the route bumps it on a clash; a
 * reserved slug or a catalog agent's gets the random suffix too, because
 * adding that catalog agent later upserts by slug and would overwrite the
 * teammate with the catalog's prompt (POST /api/agents/[slug]/install).
 */
export function teammateSlug(name: string, visibility: TeammateVisibility): string {
  const base = slugPart(name);
  if (visibility === "PRIVATE") return `t-${base}-${randomSuffix()}`;
  const taken = isReservedAgentSlug(base) || Object.prototype.hasOwnProperty.call(AGENTS_BY_SLUG, base);
  return taken ? `${base}-${randomSuffix()}` : base;
}
