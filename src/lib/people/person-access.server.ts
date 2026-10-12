import "server-only";

// Who the viewer is to a person, on the server: the one answer every people
// route in the Teams hub asks (GET/PATCH /api/users/[id], the directory's
// people-data fields, skills, dotted lines, the bulk bar, the org chart's
// edit mode). It joins the two report-tree walkers the product has so that
// neither ladder's reach shrinks: the engine's effective tree (solid plus
// dotted, six deep) and the legacy solid tree (unlimited depth), which is
// what the person page and the person APIs disagreed on before (a dotted-line
// manager saw a "manage" page over a minimal payload and a 403 on save).
//
// Relationship order, strongest first: self, admin, people-team, org-wide
// (the legacy C-level, VP and Director reach), chain (manager tier over the
// solid tree: writes as yesterday), chain-view (dotted or below manager
// tier: reads only), none.

import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";
import type { Viewer } from "@/lib/access/types";
import { getTeamUserIds } from "@/lib/team";
import { ORG_WIDE_ALIGNMENT_LEVELS } from "@/lib/alignment-scope";
import { legacyIsManagerLevel } from "@/lib/access/legacy-levels";
import type { PersonRelation } from "./person-fields";
import { inWorkspaceWhere, levelHeldIn } from "@/lib/access/acting-workspace";
import { agentIdsIn, managerCandidateIn } from "@/lib/access/manager-candidate";
import { liveHereAmong } from "@/lib/access/manager-lines";

export interface PeopleCtx {
  userId: string;
  organizationId: string;
  accessLevel: string;
  orgRole: string;
  isAgent: boolean;
  isAdmin: boolean;
  peopleTeam: boolean;
  /** Reads people data org-wide (Admin, People team, the legacy org-wide levels). */
  orgWide: boolean;
  /** Legacy manager tier (kept for the rules that could act yesterday). */
  managerTier: boolean;
  /** Everyone below the viewer, solid or dotted, self excluded (the read reach). */
  chain: Set<string>;
  /**
   * The write reach: a manager-tier viewer's SOLID report tree, any depth,
   * self excluded. Exactly yesterday's canTouchUserAlignment door, so write
   * rights over a person never grow with a dotted line or a report.
   */
  writeChain: Set<string>;
  /** The engine's viewer, for the node-access reads (readable Lists). */
  viewer: Viewer;
}

/** Build the context once per request. Null when signed out. */
export async function peopleCtx(): Promise<PeopleCtx | null> {
  const viewer = await viewerFromSession();
  if (!viewer) return null;
  return peopleCtxForViewer(viewer);
}

/**
 * The same context for a Viewer the caller already holds (a dashboard card
 * computed for a scheduled email has no session, only the recipient's
 * Viewer), so every people rule reads one shape.
 */
export async function peopleCtxForViewer(viewer: Viewer): Promise<PeopleCtx> {
  // The level held in the workspace this viewer acts in, never the anchored
  // workspace's level there (src/lib/access/acting-workspace.ts): an Admin of
  // a workspace they created is a Member where their membership says Member.
  const accessLevel = (await levelHeldIn(viewer.userId, viewer.organizationId)) ?? "EMPLOYEE";
  const isAdmin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
  // An Agent is never anyone's manager (AGENT_TIER_BLURB): no chain and no
  // chain-view, whatever lines stored before rule 6 still name them. The
  // walkers already answer nobody below an Agent (manager-lines.ts); this
  // holds for the level the session acts at too.
  const chain = new Set<string>(viewer.isAgent ? [] : viewer.reportTree ?? []);
  const managerTier = legacyIsManagerLevel(accessLevel);
  const writeChain = new Set<string>();
  // The legacy walker reaches further down solid lines; union, never narrow.
  if (!viewer.isAgent && (managerTier || chain.size > 0)) {
    try {
      for (const id of await getTeamUserIds(viewer.organizationId, viewer.userId)) {
        chain.add(id);
        if (managerTier) writeChain.add(id);
      }
    } catch {
      // The engine's tree alone still answers reads; writes fail closed.
    }
  }
  chain.delete(viewer.userId);
  writeChain.delete(viewer.userId);
  const peopleTeam = viewer.peopleTeam === true;
  return {
    userId: viewer.userId,
    organizationId: viewer.organizationId,
    accessLevel,
    orgRole: viewer.orgRole,
    isAgent: viewer.isAgent,
    isAdmin,
    peopleTeam,
    orgWide: isAdmin || peopleTeam || ORG_WIDE_ALIGNMENT_LEVELS.has(accessLevel),
    managerTier,
    chain,
    writeChain,
    viewer,
  };
}

export function relationTo(ctx: PeopleCtx, subjectId: string): PersonRelation {
  if (ctx.orgRole === "GUEST") return subjectId === ctx.userId ? "self" : "none";
  if (subjectId === ctx.userId) return "self";
  if (ctx.isAdmin) return "admin";
  if (ctx.peopleTeam) return "people-team";
  if (ctx.orgWide) return "org-wide";
  if (ctx.writeChain.has(subjectId)) return "chain";
  if (ctx.chain.has(subjectId)) return "chain-view";
  return "none";
}

/** May the viewer read this person's people data? */
export function readsPeopleDataOf(ctx: PeopleCtx, subjectId: string): boolean {
  return relationTo(ctx, subjectId) !== "none";
}

/** Owner, Admin or the People team: the Removed view, No manager, Deactivated, bulk edits. */
export function isPeopleAdmin(ctx: PeopleCtx): boolean {
  return ctx.isAdmin || ctx.peopleTeam;
}

/**
 * The org's manager map, for the cycle check (one narrow query): everyone
 * who works here, anchored here or through a membership here (docs-found
 * fixes batch 5), so a loop through someone who last switched to another
 * workspace is still seen.
 */
export async function managerMapFor(organizationId: string): Promise<Map<string, string | null>> {
  const rows = await prisma.user.findMany({
    where: { deletedAt: null, ...inWorkspaceWhere(organizationId) },
    select: { id: true, managerId: true },
  });
  return new Map(rows.map((r) => [r.id, r.managerId]));
}

/**
 * Is `managerId` a valid manager for someone in this org? In this workspace
 * (anchored here, or a membership here), not removed, and never an Agent at
 * the tier held here (access 2.4: an Agent cannot be a manager). The one
 * rule, manager-candidate.ts managerCandidateIn (batch 5: this read the
 * anchored row only, so a manager who had switched away was "not in this
 * workspace").
 */
export async function checkManagerCandidate(
  organizationId: string,
  managerId: string,
): Promise<"ok" | "not_found" | "agent_cannot_manage"> {
  const c = await managerCandidateIn(organizationId, managerId);
  return c === "inactive" ? "ok" : c;
}

/**
 * Of these ids, how many are people of this workspace (anchored here or a
 * membership here, not removed), and which of them hold the Agent tier here
 * (never anyone's manager, access 2.4).
 */
export async function agentIdsAmong(organizationId: string, ids: string[]): Promise<{ found: number; agents: string[] }> {
  if (ids.length === 0) return { found: 0, agents: [] };
  const [here, agents] = await Promise.all([liveHereAmong(organizationId, ids), agentIdsIn(organizationId, ids)]);
  return { found: [...new Set(ids)].filter((id) => here.has(id)).length, agents: [...here].filter((id) => agents.has(id)) };
}
