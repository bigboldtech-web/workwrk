// The access backfill's plan for one organisation (access-model-spec section
// 10 step 4, graft G11 the pre-flight report, graft G5 reach preservation;
// Phase 8 stage E). Pure: scripts/access-backfill.ts loads the snapshot, calls
// planOrgBackfill, prints the pre-flight report, and (with --write only) runs
// the plan in one transaction per organisation with the row-count
// assertions below.
//
// WHAT THE PLAN WRITES, and why each write changes nobody's reach with the
// flags off (every reader of these columns sits behind ACCESS_V2_TABLES):
//
//   User.orgRole / isAgent        the spec 2.1 mapping: the Owner pick
//                                 (ownerIdsOf, the same rule the Staff
//                                 console and SETTINGS_OWNER_SPLIT use),
//                                 every other admin ADMIN, the rest MEMBER,
//                                 AGENT the Agent flag. Read only through
//                                 effectiveOrgRole, which lets the column
//                                 refine an Admin to Owner and nothing else.
//   settings.access               only where the org has none: the values
//                                 TODAY'S code enforces (findableSpaces and
//                                 editorsCanShare false), never the section 8
//                                 defaults, which would widen an existing
//                                 workspace nobody asked about. An org that
//                                 already stores the block keeps it; the
//                                 report flags one whose two widening toggles
//                                 read true (the old defaults merge wrote
//                                 them without anyone choosing them).
//   settings.access.peopleTeamUserIds  seeded with the HR people when empty,
//                                 which is who the People team is today.
//   Space/Folder/Board.restricted  PRIVATE Folders and Lists (spec 3.2).
//   Space.findable                 visibility ORG (conservative, spec 10 step 4.3).
//   ownerId where null             the container's OWNER member row.
//   AccessGrant (USER subjects)    SOPFolderAccess rows (SOP_FOLDER), and G5's
//                                  explicit Full for the Space owner on every
//                                  PRIVATE List (the pierce node-access already
//                                  gives, made visible in the dialog).
//
// WHAT IT PLANS BUT DOES NOT WRITE (counted in the report): the EVERYONE
// rows (Space and List visibility ORG, G5's org-visible standalone Docs,
// org-wide Whiteboards, unscoped Tables). "AccessGrant".subjectId carries a
// foreign key to "User" and a CHECK of USER only; an EVERYONE row needs that
// key replaced first, which is step 8's file. Until then the visibility
// columns ARE those grants (node-access reads them), so no reach depends on
// the deferred rows.

import { ownerIdsOf } from "../admin/companies-list";
import { TODAY_EQUIVALENT_ACCESS_SETTINGS, parseAccessSettings } from "./settings";
import type { AccessSettings, OrgRole } from "./types";

export interface BackfillUser {
  id: string;
  name: string;
  accessLevel: string;
  createdAt: Date | string;
  managerId: string | null;
  orgRole: string | null;
  isAgent: boolean;
  live: boolean;
}

export interface BackfillSnapshot {
  organizationId: string;
  organizationName: string;
  settings: Record<string, unknown> | null;
  users: BackfillUser[];
  apiKeys: { id: string; name: string; scopes: string[]; createdById: string; revoked: boolean }[];
  sopFolderAccess: { folderId: string; userId: string; role: "VIEWER" | "EDITOR" | "OWNER" }[];
  spaces: { id: string; visibility: string; ownerId: string | null; ownerRowUserId: string | null; restricted: boolean; findable: boolean }[];
  folders: { id: string; visibility: string; ownerId: string | null; ownerRowUserId: string | null; restricted: boolean }[];
  boards: { id: string; visibility: string; ownerId: string | null; ownerRowUserId: string | null; spaceId: string | null; restricted: boolean }[];
  /** Deferred EVERYONE rows, counted only. */
  orgVisibleStandaloneDocs: number;
  orgWideWhiteboards: number;
  unscopedTables: number;
  /** Keys "TYPE:objectId:userId" already in AccessGrant (a re-run writes nothing twice). */
  existingGrantKeys: ReadonlySet<string>;
}

export interface PlannedGrant {
  objectType: "SOP_FOLDER" | "LIST";
  objectId: string;
  subjectId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
  objectRole: "FULL" | "EDIT" | "VIEW";
  why: string;
}

export interface OrgBackfillPlan {
  organizationId: string;
  organizationName: string;
  preflight: {
    owners: { id: string; name: string; accessLevel: string }[];
    superAdmins: { id: string; name: string }[];
    executivesNotWholeOrg: { id: string; name: string; accessLevel: string; reports: number; liveOthers: number }[];
    managersWithNoReports: { id: string; name: string; accessLevel: string }[];
    adminKeysWithNonAdminCreator: { id: string; name: string; creatorId: string; creatorLevel: string | null }[];
    widenedAccessToggles: boolean;
    noOwner: boolean;
    /** Live people in the workspace (a no-Owner workspace with people needs the Staff console's Set Owner). */
    livePeople: number;
    /**
     * The decided rule (the Owner is the earliest COMPANY_ADMIN) and today's
     * pick disagree: an earlier SUPER_ADMIN keeps the earliest COMPANY_ADMIN
     * out of Owner. The report names it for the founder's decision; the pick
     * itself is not changed here, because the same pick guards role changes
     * with the flags off (a later hire would otherwise become an Owner over a
     * founder who is SUPER_ADMIN).
     */
    ownerPickConflict: { earliestCompanyAdmin: { id: string; name: string }; earlierSuperAdmins: { id: string; name: string }[] } | null;
    /** People below the manager tier who gain New Space when the stored toggle 1 reads Everyone and the resolver is on. */
    everyoneCreatesSpacesWiderThanToday: number;
    cLevelLosesSettingsWrite: { id: string; name: string }[];
  };
  userUpdates: { id: string; orgRole: OrgRole; isAgent: boolean }[];
  accessSettingsWrite: AccessSettings | null;
  peopleTeamSeed: string[] | null;
  restrictedFolders: string[];
  restrictedBoards: string[];
  findableSpaces: string[];
  ownerFills: { type: "Space" | "Folder" | "Board"; id: string; ownerId: string }[];
  grants: PlannedGrant[];
  deferredEveryone: { spaces: number; boards: number; standaloneDocs: number; whiteboards: number; tables: number };
}

const EXEC_LEVELS = new Set(["C_LEVEL", "VP", "DIRECTOR"]);
/** Who creates Spaces today (src/lib/template-center.ts SPACE_CREATE_LEVELS, copied: this file is pure). */
const SPACE_CREATE_TODAY = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD"]);

/** The earliest live COMPANY_ADMIN when an earlier SUPER_ADMIN keeps them out of today's Owner pick; else null. */
export function ownerPickConflictOf(live: readonly Pick<BackfillUser, "id" | "name" | "accessLevel" | "createdAt">[]): OrgBackfillPlan["preflight"]["ownerPickConflict"] {
  const t = (u: { createdAt: Date | string }) => new Date(u.createdAt).getTime();
  const cas = live.filter((u) => u.accessLevel === "COMPANY_ADMIN").sort((a, b) => t(a) - t(b) || a.id.localeCompare(b.id));
  const first = cas[0];
  if (!first) return null;
  const earlier = live.filter((u) => u.accessLevel === "SUPER_ADMIN" && (t(u) < t(first) || (t(u) === t(first) && u.id.localeCompare(first.id) < 0)));
  if (earlier.length === 0) return null;
  return { earliestCompanyAdmin: { id: first.id, name: first.name }, earlierSuperAdmins: earlier.map((u) => ({ id: u.id, name: u.name })) };
}
const MANAGER_LEVELS = new Set(["MANAGER", "TEAM_LEAD"]);

/** Descendant counts over the manager graph, cycle-safe. */
export function reportTreeSizes(users: readonly Pick<BackfillUser, "id" | "managerId" | "live">[]): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const u of users) {
    if (!u.live || !u.managerId) continue;
    const list = children.get(u.managerId) ?? [];
    list.push(u.id);
    children.set(u.managerId, list);
  }
  const out = new Map<string, number>();
  for (const u of users) {
    const seen = new Set<string>([u.id]);
    const stack = [...(children.get(u.id) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(children.get(id) ?? []));
    }
    out.set(u.id, seen.size - 1);
  }
  return out;
}

const SOP_ROLE: Record<"VIEWER" | "EDITOR" | "OWNER", { role: PlannedGrant["role"]; objectRole: PlannedGrant["objectRole"] }> = {
  VIEWER: { role: "GUEST", objectRole: "VIEW" },
  EDITOR: { role: "MEMBER", objectRole: "EDIT" },
  OWNER: { role: "ADMIN", objectRole: "FULL" },
};

export function planOrgBackfill(s: BackfillSnapshot): OrgBackfillPlan {
  const live = s.users.filter((u) => u.live);
  const byId = new Map(s.users.map((u) => [u.id, u]));
  const ownerIds = new Set(ownerIdsOf(live.map((u) => ({ id: u.id, level: u.accessLevel, createdAt: u.createdAt }))));
  const tree = reportTreeSizes(s.users);
  const liveOthers = Math.max(0, live.length - 1);

  const roleFor = (u: BackfillUser): OrgRole => {
    if (ownerIds.has(u.id)) return "OWNER";
    if (u.accessLevel === "SUPER_ADMIN") return "OWNER";
    if (u.accessLevel === "COMPANY_ADMIN") return "ADMIN";
    return "MEMBER";
  };

  const userUpdates = s.users
    .map((u) => ({ id: u.id, orgRole: roleFor(u), isAgent: u.accessLevel === "AGENT" }))
    .filter((w) => {
      const u = byId.get(w.id)!;
      return u.orgRole !== w.orgRole || u.isAgent !== w.isAgent;
    });

  const stored = (s.settings as { access?: unknown } | null)?.access;
  const hasAccess = !!stored && typeof stored === "object";
  const parsed = parseAccessSettings(stored);
  const accessSettingsWrite = hasAccess ? null : { ...TODAY_EQUIVALENT_ACCESS_SETTINGS };
  const hrIds = live.filter((u) => u.accessLevel === "HR").map((u) => u.id);
  const peopleTeamSeed = parsed.peopleTeamUserIds.length === 0 && hrIds.length > 0 ? hrIds : null;

  const grants: PlannedGrant[] = [];
  const has = (t: string, o: string, u: string) => s.existingGrantKeys.has(`${t}:${o}:${u}`);
  for (const r of s.sopFolderAccess) {
    if (!byId.get(r.userId)?.live || has("SOP_FOLDER", r.folderId, r.userId)) continue;
    grants.push({ objectType: "SOP_FOLDER", objectId: r.folderId, subjectId: r.userId, ...SOP_ROLE[r.role], why: `SOPFolderAccess ${r.role}` });
  }
  const spaceOwner = new Map(s.spaces.map((sp) => [sp.id, sp.ownerId ?? sp.ownerRowUserId]));
  for (const b of s.boards) {
    if (b.visibility !== "PRIVATE" || !b.spaceId) continue;
    const owner = spaceOwner.get(b.spaceId);
    if (!owner || owner === b.ownerId || !byId.get(owner)?.live || has("LIST", b.id, owner)) continue;
    grants.push({ objectType: "LIST", objectId: b.id, subjectId: owner, role: "ADMIN", objectRole: "FULL", why: "G5: the Space owner keeps Full access on a Private List" });
  }

  const ownerFills: OrgBackfillPlan["ownerFills"] = [];
  for (const sp of s.spaces) if (!sp.ownerId && sp.ownerRowUserId) ownerFills.push({ type: "Space", id: sp.id, ownerId: sp.ownerRowUserId });
  for (const f of s.folders) if (!f.ownerId && f.ownerRowUserId) ownerFills.push({ type: "Folder", id: f.id, ownerId: f.ownerRowUserId });
  for (const b of s.boards) if (!b.ownerId && b.ownerRowUserId) ownerFills.push({ type: "Board", id: b.id, ownerId: b.ownerRowUserId });

  const name = (id: string) => byId.get(id)?.name ?? id;
  return {
    organizationId: s.organizationId,
    organizationName: s.organizationName,
    preflight: {
      owners: [...ownerIds].map((id) => ({ id, name: name(id), accessLevel: byId.get(id)?.accessLevel ?? "?" })),
      superAdmins: live.filter((u) => u.accessLevel === "SUPER_ADMIN").map((u) => ({ id: u.id, name: u.name })),
      executivesNotWholeOrg: live
        .filter((u) => EXEC_LEVELS.has(u.accessLevel) && (tree.get(u.id) ?? 0) < liveOthers)
        .map((u) => ({ id: u.id, name: u.name, accessLevel: u.accessLevel, reports: tree.get(u.id) ?? 0, liveOthers })),
      managersWithNoReports: live
        .filter((u) => MANAGER_LEVELS.has(u.accessLevel) && (tree.get(u.id) ?? 0) === 0)
        .map((u) => ({ id: u.id, name: u.name, accessLevel: u.accessLevel })),
      adminKeysWithNonAdminCreator: s.apiKeys
        .filter((k) => !k.revoked && k.scopes.includes("ADMIN"))
        .filter((k) => {
          const c = byId.get(k.createdById);
          return !c || !c.live || (c.accessLevel !== "SUPER_ADMIN" && c.accessLevel !== "COMPANY_ADMIN");
        })
        .map((k) => ({ id: k.id, name: k.name, creatorId: k.createdById, creatorLevel: byId.get(k.createdById)?.accessLevel ?? null })),
      widenedAccessToggles: hasAccess && (parsed.findableSpaces || parsed.editorsCanShare),
      noOwner: ownerIds.size === 0,
      livePeople: live.length,
      ownerPickConflict: ownerPickConflictOf(live),
      everyoneCreatesSpacesWiderThanToday:
        (hasAccess ? parsed.whoCanCreateSpaces : TODAY_EQUIVALENT_ACCESS_SETTINGS.whoCanCreateSpaces) === "everyone"
          ? live.filter((u) => !SPACE_CREATE_TODAY.has(u.accessLevel) && u.accessLevel !== "AGENT").length
          : 0,
      cLevelLosesSettingsWrite: live.filter((u) => u.accessLevel === "C_LEVEL").map((u) => ({ id: u.id, name: u.name })),
    },
    userUpdates,
    accessSettingsWrite,
    peopleTeamSeed,
    restrictedFolders: s.folders.filter((f) => f.visibility === "PRIVATE" && !f.restricted).map((f) => f.id),
    restrictedBoards: s.boards.filter((b) => b.visibility === "PRIVATE" && !b.restricted).map((b) => b.id),
    findableSpaces: s.spaces.filter((sp) => sp.visibility === "ORG" && !sp.findable).map((sp) => sp.id),
    ownerFills,
    grants,
    deferredEveryone: {
      spaces: s.spaces.filter((sp) => sp.visibility === "ORG").length,
      boards: s.boards.filter((b) => b.visibility === "ORG").length,
      standaloneDocs: s.orgVisibleStandaloneDocs,
      whiteboards: s.orgWideWhiteboards,
      tables: s.unscopedTables,
    },
  };
}

/** The assertions a --write checks inside the org's transaction before it commits. */
export function backfillAssertions(
  plan: OrgBackfillPlan,
  written: { users: number; grants: number; restrictedFolders: number; restrictedBoards: number; findable: number; ownerFills: number; usersWithoutRole: number; owners: number },
): string[] {
  const out: string[] = [];
  if (written.users !== plan.userUpdates.length) out.push(`users: wrote ${written.users}, planned ${plan.userUpdates.length}`);
  if (written.grants !== plan.grants.length) out.push(`grants: wrote ${written.grants}, planned ${plan.grants.length}`);
  if (written.restrictedFolders !== plan.restrictedFolders.length) out.push(`restricted folders: wrote ${written.restrictedFolders}, planned ${plan.restrictedFolders.length}`);
  if (written.restrictedBoards !== plan.restrictedBoards.length) out.push(`restricted lists: wrote ${written.restrictedBoards}, planned ${plan.restrictedBoards.length}`);
  if (written.findable !== plan.findableSpaces.length) out.push(`findable spaces: wrote ${written.findable}, planned ${plan.findableSpaces.length}`);
  if (written.ownerFills !== plan.ownerFills.length) out.push(`owner fills: wrote ${written.ownerFills}, planned ${plan.ownerFills.length}`);
  if (written.usersWithoutRole !== 0) out.push(`${written.usersWithoutRole} people still have no orgRole`);
  if (written.owners < 1) out.push("the workspace has no Owner");
  return out;
}
