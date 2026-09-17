// The parity harness (spec 10 step 2, graft G6).
//
// Given ONE description of a world, it computes today's answer and the
// engine's answer and reports the difference. Every difference must be in
// EXPECTED_MISMATCHES with a named source, or the harness fails: "zero
// unexpected mismatches for a week" is the criterion for the step-4 read-path
// flip, and this is the function that measures it.
//
// HOW THE OLD ANSWER IS COMPUTED, and why. The legacy helpers are async and
// read Prisma; vitest here is node-only over src/lib/**/*.test.ts with no
// database and no "@/" alias, so they cannot be called from a test. The old
// answer is therefore a BRANCH-FOR-BRANCH transcription of the real functions,
// with the file and line of every branch in a comment, over a LegacyInputs
// struct that holds exactly the rows those functions select. The engine's
// answer is computed from AccessFacts DERIVED FROM THE SAME struct by
// `factsFromLegacy`, so both halves genuinely see one world.
// When the nightly job of step 2 lands it must fill LegacyInputs from the same
// Prisma reads the real helpers make, which keeps the transcription honest;
// until then the transcription is the contract and the citations are how it is
// reviewed.
//
// Pure: imports ./types, ./settings, ./org-role, ./resolve. No Prisma, no
// clock, no schedule. Wiring this to a cron is step 2's job, not step 0's.

import {
  emptyRelationships,
  type AccessFacts,
  type Action,
  type AppKey,
  type ChainLink,
  type Decision,
  type GrantFact,
  type ObjectFacts,
  type ObjectRole,
  type ObjectType,
  type Relationships,
  type Viewer,
} from "./types";
import { TODAY_EQUIVALENT_ACCESS_SETTINGS, roleFromDefaultPermission } from "./settings";
import { isAgentOf, isSeededPeopleTeam, orgRoleOf } from "./org-role";
import { legacyIsAdminLevel, legacyIsManagerLevel, legacyTierAllows } from "./legacy-levels";
import { decide } from "./resolve";

// ── What today's helpers see ──────────────────────────────────────

export type SpaceRoleValue = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
export type VisibilityValue = "PRIVATE" | "WORKSPACE" | "ORG";

export interface LegacySpace {
  id: string;
  organizationId: string;
  visibility: VisibilityValue;
  ownerId: string | null;
  /** The viewer's own SpaceMember row, or null. */
  memberRole: SpaceRoleValue | null;
  archived?: boolean;
  name?: string;
  /**
   * Space.settings, for the dead "Default permission" select spec 3.1 turns
   * into the role of the Space's EVERYONE grant. No legacy branch reads it
   * (that is audit Broken #9), so it only ever moves the engine half, which is
   * exactly what makes it comparable to facts.ts.
   */
  settings?: unknown;
}

export interface LegacyFolder {
  id: string;
  organizationId: string;
  spaceId: string;
  parentFolderId?: string | null;
  visibility: VisibilityValue;
  ownerId: string | null;
  /** The viewer's own FolderMember row, or null. */
  memberRole: SpaceRoleValue | null;
  /** The viewer's FolderMember row on the nearest ancestor folder, or null. */
  ancestorMemberRole?: SpaceRoleValue | null;
  archived?: boolean;
  name?: string;
}

export interface LegacyBoard {
  id: string;
  organizationId: string;
  spaceId: string | null;
  folderId: string | null;
  visibility: VisibilityValue;
  ownerId: string | null;
  /** The viewer's own BoardMember row, or null. */
  memberRole: SpaceRoleValue | null;
  archived?: boolean;
  name?: string;
}

export interface LegacyItem {
  id: string;
  organizationId: string;
  boardId: string;
  /** Item.ownerId is the primary assignee (the DRI), not a creator. */
  ownerId: string | null;
  assigneeIds: string[];
}

export interface LegacyDocAnchor {
  entityType: string | null;
  entityId: string | null;
}

export interface LegacyInputs {
  userId: string;
  organizationId: string;
  /** Today's User.accessLevel, verbatim. */
  accessLevel: string | null;
  space?: LegacySpace | null;
  folder?: LegacyFolder | null;
  board?: LegacyBoard | null;
  item?: LegacyItem | null;
  doc?: { id: string; organizationId: string; createdById: string | null; anchor: LegacyDocAnchor } | null;
  /** For the isManager and rail-tier helpers. */
  hasReports?: boolean;
  /**
   * On the People team. Today there is no such concept outside the HR rung, so
   * every legacy transcription ignores this field; the engine reads it. That
   * asymmetry IS the "hr-admin tier becomes the People team" change.
   */
  peopleTeam?: boolean;
  /** Org apps config, for canAccessTier parity. */
  appKey?: AppKey;
  /**
   * User.status. No gate in the codebase reads it today, so the legacy half
   * ignores it; rule 1 does read it, so a harness that hard-coded "ACTIVE"
   * could never report a status difference (which is how the deviation
   * recorded under "rule-1-status-follows-auth-not-the-literal-spec" stayed
   * invisible).
   */
  status?: string | null;
}

// ── Today's answers, transcribed ──────────────────────────────────

// The four tier lists live in ./legacy-levels, which is also what the step-1
// delegates in space.ts, board.ts, folder.ts, access.ts, api-helpers.ts,
// page-gates.ts, route-guard.ts and access-tiers.ts now import. One copy.
const isAdminLevel = legacyIsAdminLevel;

/** space.ts:194-204 getSpaceForReader. Returns the row; true here means "a row". */
function legacyGetSpaceForReader(i: LegacyInputs): boolean {
  const space = i.space;
  if (!space) return false; // :199
  if (isAdminLevel(i.accessLevel)) return true; // :200
  if (space.visibility === "ORG") return true; // :201
  if (space.memberRole) return true; // :202 — ANY role, GUEST included
  return false; // :203
}

/** space.ts:210-217 canEditSpace. */
function legacyCanEditSpace(i: LegacyInputs): boolean {
  if (isAdminLevel(i.accessLevel)) return true; // :211
  const role = i.space?.memberRole ?? null; // :212-215
  return role === "OWNER" || role === "ADMIN"; // :216
}

/** space.ts:225-232 canContributeSpace. */
function legacyCanContributeSpace(i: LegacyInputs): boolean {
  if (isAdminLevel(i.accessLevel)) return true; // :226
  const role = i.space?.memberRole ?? null; // :227-230
  return !!role && role !== "GUEST"; // :231
}

/** board.ts:605-665 getBoardForReader. */
function legacyGetBoardForReader(i: LegacyInputs): boolean {
  const board = i.board;
  if (!board) return false; // :614
  if (isAdminLevel(i.accessLevel)) return true; // :617
  if (board.memberRole) return true; // :623-627 — ANY role, GUEST included
  // :632-637 private-folder cascade, checks folder.ownerId ONLY (never FolderMember)
  if (board.folderId && i.folder && i.folder.id === board.folderId) {
    if (i.folder.visibility === "PRIVATE" && i.folder.ownerId !== i.userId) return false;
  }
  if (board.visibility === "ORG") return true; // :640
  if (board.visibility === "PRIVATE") {
    if (board.ownerId === i.userId) return true; // :644
    // :646-651 Space OWNER only; a Space ADMIN does NOT pierce.
    if (board.spaceId && i.space?.memberRole === "OWNER") return true;
    return false; // :654-658, the BoardMember row was already checked at :623
  }
  // :661-664 WORKSPACE -> inherit the Space
  if (!board.spaceId) return false;
  return legacyGetSpaceForReader(i);
}

/** board.ts:672-705 canEditBoard. */
function legacyCanEditBoard(i: LegacyInputs): boolean {
  if (isAdminLevel(i.accessLevel)) return true; // :677
  const board = i.board;
  if (!board) return false; // :682
  if (board.ownerId === i.userId) return true; // :683
  if (board.visibility === "PRIVATE") {
    // :690 BoardMember OWNER/ADMIN
    if (board.memberRole === "OWNER" || board.memberRole === "ADMIN") return true;
    // :693-699 Space OWNER only
    if (board.spaceId) return i.space?.memberRole === "OWNER";
    return false; // :700
  }
  if (!board.spaceId) return false; // :703
  return legacyCanEditSpace(i); // :704
}

/** board.ts:716-747 canContributeBoard. */
function legacyCanContributeBoard(i: LegacyInputs): boolean {
  if (isAdminLevel(i.accessLevel)) return true; // :721
  const board = i.board;
  if (!board) return false; // :726
  if (board.ownerId === i.userId) return true; // :727
  if (board.memberRole && board.memberRole !== "GUEST") return true; // :731-735
  if (board.visibility === "PRIVATE") return false; // :738
  if (!board.spaceId) return false; // :741
  const sm = i.space?.memberRole ?? null; // :742-745
  return !!sm && sm !== "GUEST"; // :746
}

/** folder.ts:21-29 folderVisibleTo (pure and sync today). */
function legacyFolderVisibleTo(i: LegacyInputs): boolean {
  const folder = i.folder;
  if (!folder) return false;
  if (folder.visibility !== "PRIVATE") return true; // :26
  if (isAdminLevel(i.accessLevel)) return true; // :27
  return folder.ownerId === i.userId; // :28
}

/** folder.ts:171-207 folderReadable. */
function legacyFolderReadable(i: LegacyInputs): boolean {
  if (isAdminLevel(i.accessLevel)) return true; // :176
  const folder = i.folder;
  if (!folder) return false; // :184
  if (folder.memberRole || folder.ownerId === i.userId) return true; // :185
  if (folder.ancestorMemberRole) return true; // :188-197, the 8-hop walk
  if (folder.visibility === "PRIVATE") return false; // :200
  const space = i.space;
  if (!space) return false; // :205
  return space.visibility === "ORG" || !!space.memberRole; // :206
}

/** doc-access.ts:27-39 boardReadableWithFolder. */
function legacyBoardReadableWithFolder(i: LegacyInputs): boolean {
  if (legacyGetBoardForReader(i)) return true; // :32
  if (i.board?.folderId) return legacyFolderReadable(i); // :37
  return false; // :38
}

/** doc-access.ts:41-88 docAccessible. */
function legacyDocAccessible(i: LegacyInputs): boolean {
  const anchor = i.doc?.anchor;
  if (!anchor || !anchor.entityType || !anchor.entityId) return true; // :46 — open by default
  // :48 the default that silently strips org-admin when a caller passes undefined
  switch (anchor.entityType) {
    case "SPACE":
      return legacyGetSpaceForReader(i); // :50-52
    case "BOARD":
      return legacyBoardReadableWithFolder(i); // :54-56
    case "BOARD_ITEM":
      if (!i.item) return false; // :64
      return legacyBoardReadableWithFolder(i); // :65
    case "FOLDER":
      return legacyFolderReadable(i); // :68-72
    case "NOTEPAD":
      // :74-82 owner only, regardless of access level: no admin read-around.
      return anchor.entityId === i.userId;
    default:
      return true; // :87 — unknown anchor types fall open
  }
}

export type LegacyPermission = "none" | "read" | "edit" | "admin";

/**
 * access.ts's resolvers return `{ permission, reason }`, not a bare
 * permission, and GET /api/me/access serves the reason string verbatim. So the
 * transcription carries the reasons too, and the permission-only functions
 * below derive from these. One transcription, two views: the step-1 delegates
 * in src/lib/access.ts call the detailed form and hand back the same object
 * shape their callers already destructure.
 */
export interface LegacyDecision {
  permission: LegacyPermission;
  reason: string;
}

const NONE = (reason: string): LegacyDecision => ({ permission: "none", reason });
const ADMIN_OVERRIDE: LegacyDecision = { permission: "admin", reason: "org admin override" };

/** access.ts:129-150 resolveSpace. */
function legacyResolveSpaceDetailed(i: LegacyInputs): LegacyDecision {
  const space = i.space;
  if (!space || space.organizationId !== i.organizationId) {
    return NONE("space not found in your org"); // :134
  }
  if (isAdminLevel(i.accessLevel)) return ADMIN_OVERRIDE; // :137
  const role = space.memberRole;
  if (role === "OWNER" || role === "ADMIN") {
    return { permission: "edit", reason: `space ${role.toLowerCase()}` }; // :140
  }
  if (role === "MEMBER" || role === "GUEST") {
    return { permission: "read", reason: `space ${role.toLowerCase()}` }; // :143
  }
  if (space.visibility === "ORG") {
    return { permission: "read", reason: "space is org-visible" }; // :146
  }
  return NONE("not a member of this space"); // :149
}

/** access.ts:85-93 roleToDecision. */
function legacyRoleToDecision(
  role: SpaceRoleValue | null | undefined,
  reason: string,
): LegacyDecision | null {
  if (role === "OWNER" || role === "ADMIN") {
    return { permission: "edit", reason: `${reason} (${role.toLowerCase()})` };
  }
  if (role === "MEMBER" || role === "GUEST") {
    return { permission: "read", reason: `${reason} (${role.toLowerCase()})` };
  }
  return null;
}

/** access.ts:158-199 resolveFolder. */
function legacyResolveFolderDetailed(i: LegacyInputs): LegacyDecision {
  const folder = i.folder;
  if (!folder || folder.organizationId !== i.organizationId) {
    return NONE("folder not found in your org"); // :167
  }
  if (isAdminLevel(i.accessLevel)) return ADMIN_OVERRIDE; // :170
  const grant = legacyRoleToDecision(folder.memberRole, "folder member"); // :172
  if (grant) return grant;
  if (folder.ownerId === i.userId) {
    return { permission: "edit", reason: "folder owner" }; // :174
  }
  // :177-187, the 8-hop ancestor walk. ancestorMemberRole is the role on the
  // NEAREST ancestor carrying a row, which is where the real walk returns.
  const inherited = legacyRoleToDecision(folder.ancestorMemberRole, "inherited folder grant");
  if (inherited) return inherited;
  if (folder.visibility === "PRIVATE") {
    return NONE("folder is private"); // :194
  }
  return legacyResolveSpaceDetailed(i); // :198 — the Space's reason flows through
}

/** access.ts:201-227 resolveBoard. It NEVER reads BoardMember. */
function legacyResolveBoardDetailed(i: LegacyInputs): LegacyDecision {
  const board = i.board;
  if (!board || board.organizationId !== i.organizationId) {
    return NONE("board not found in your org"); // :206
  }
  if (isAdminLevel(i.accessLevel)) return ADMIN_OVERRIDE; // :209
  if (!board.spaceId && !board.folderId) {
    return NONE("board not attached to a space"); // :210
  }
  const decision = board.folderId
    ? legacyResolveFolderDetailed(i)
    : legacyResolveSpaceDetailed(i); // :218-220
  if (decision.permission === "none") return decision; // :221 — reason included
  if (board.visibility === "PRIVATE" && decision.permission === "read") {
    return NONE("board is private to its owners"); // :223-225
  }
  return decision; // :226
}

/** access.ts:267-284 resolveItem. */
function legacyResolveItemDetailed(i: LegacyInputs): LegacyDecision {
  const item = i.item;
  if (!item || item.organizationId !== i.organizationId) {
    return NONE("item not found in your org"); // :272
  }
  if (isAdminLevel(i.accessLevel)) return ADMIN_OVERRIDE; // :275
  const boardDecision = legacyResolveBoardDetailed(i); // :277
  if (boardDecision.permission === "none") return boardDecision; // :278
  if (item.ownerId === i.userId && boardDecision.permission === "read") {
    return { permission: "edit", reason: "you own this item" }; // :280-282
  }
  return boardDecision; // :283
}

/** access.ts:234-265 resolveDoc. The admin override at :242 runs BEFORE the
 *  NOTEPAD check at :248, which is the disagreement with doc-access.ts:74-81. */
function legacyResolveDocDetailed(i: LegacyInputs): LegacyDecision {
  const doc = i.doc;
  if (!doc || doc.organizationId !== i.organizationId) {
    return NONE("doc not found in your org"); // :239
  }
  if (isAdminLevel(i.accessLevel)) return ADMIN_OVERRIDE; // :242 — before NOTEPAD
  const anchor = doc.anchor;
  if (anchor.entityId) {
    if (anchor.entityType === "NOTEPAD") {
      return anchor.entityId === i.userId
        ? { permission: "edit", reason: "your notepad" } // :249-250
        : NONE("someone else's notepad"); // :251
    }
    if (doc.createdById === i.userId) {
      return { permission: "edit", reason: "you created this doc" }; // :253
    }
    if (anchor.entityType === "FOLDER") return legacyResolveFolderDetailed(i); // :254
    if (anchor.entityType === "SPACE") return legacyResolveSpaceDetailed(i); // :255
    if (anchor.entityType === "BOARD") return legacyResolveBoardDetailed(i); // :256
    if (
      anchor.entityType === "BOARD_ITEM" ||
      anchor.entityType === "TASK" ||
      anchor.entityType === "BOARD_ROW"
    ) {
      return legacyResolveItemDetailed(i); // :259-261
    }
  }
  if (doc.createdById === i.userId) {
    return { permission: "edit", reason: "you created this doc" }; // :263
  }
  return { permission: "read", reason: "standalone note, org-visible" }; // :264
}

/** The five object resolvers of src/lib/access.ts, by kind. This is what the
 *  step-1 delegates in that file call. */
export type LegacyResolverKind = "space" | "folder" | "board" | "item" | "doc";

export function legacyResolveDetailed(i: LegacyInputs, kind: LegacyResolverKind): LegacyDecision {
  switch (kind) {
    case "space":
      return legacyResolveSpaceDetailed(i);
    case "folder":
      return legacyResolveFolderDetailed(i);
    case "board":
      return legacyResolveBoardDetailed(i);
    case "item":
      return legacyResolveItemDetailed(i);
    case "doc":
      return legacyResolveDocDetailed(i);
  }
}

const legacyResolveSpace = (i: LegacyInputs): LegacyPermission =>
  legacyResolveSpaceDetailed(i).permission;
const legacyResolveFolder = (i: LegacyInputs): LegacyPermission =>
  legacyResolveFolderDetailed(i).permission;
const legacyResolveBoard = (i: LegacyInputs): LegacyPermission =>
  legacyResolveBoardDetailed(i).permission;
const legacyResolveItem = (i: LegacyInputs): LegacyPermission =>
  legacyResolveItemDetailed(i).permission;
const legacyResolveDoc = (i: LegacyInputs): LegacyPermission =>
  legacyResolveDocDetailed(i).permission;

/** api/spaces/route.ts:11 — creating a Space is a manager-tier act today. */
function legacyCreateSpace(i: LegacyInputs): boolean {
  return legacyIsManagerLevel(i.accessLevel);
}

/** api/items/[id]/route.ts:19-37 loadAndGateRead. */
function legacyItemRead(i: LegacyInputs): boolean {
  const item = i.item;
  if (!item || item.organizationId !== i.organizationId) return false; // org mismatch -> 404
  // :30 assignment grants BOTH read and write on the row, with no board lookup
  if (item.ownerId === i.userId || item.assigneeIds.includes(i.userId)) return true;
  return legacyGetBoardForReader(i); // :34
}

/** api/items/[id]/route.ts:119-134 loadAndGate. NO assignee short-circuit. */
function legacyItemWrite(i: LegacyInputs): boolean {
  const item = i.item;
  if (!item || item.organizationId !== i.organizationId) return false;
  if (!legacyGetBoardForReader(i)) return false; // :129 -> 404
  return legacyCanContributeBoard(i); // :131 -> 403
}

/** access-tiers.ts:26-32 canAccessTier. */
function legacyCanAccessTier(i: LegacyInputs, tier: "manager" | "hr-admin" | "org-admin"): boolean {
  // :28 — an unhydrated session hides everything, handled inside legacyTierAllows.
  return legacyTierAllows(tier, i.accessLevel);
}

/** api-helpers.ts:72-77 isOrgAdmin. */
function legacyIsOrgAdmin(i: LegacyInputs): boolean {
  return isAdminLevel(i.accessLevel);
}

/** api-helpers.ts:56-67 isManager. */
function legacyIsManager(i: LegacyInputs): boolean {
  return legacyIsManagerLevel(i.accessLevel);
}

// ── The helper list step 1 will delegate ──────────────────────────

export type LegacyHelper =
  | "getSpaceForReader"
  | "canEditSpace"
  /** The POST /api/boards:119 and POST /api/folders:60 call site (D15). */
  | "canEditSpace@create_child"
  | "canContributeSpace"
  | "getBoardForReader"
  | "canReadBoard"
  | "canEditBoard"
  | "canContributeBoard"
  | "folderVisibleTo"
  | "folderReadable"
  | "docAccessible"
  | "resolveSpace"
  | "resolveFolder"
  | "resolveBoard"
  | "resolveItem"
  | "resolveDoc"
  | "itemRead"
  | "itemWrite"
  | "createSpace"
  | "canAccessTier:manager"
  | "canAccessTier:hr-admin"
  | "canAccessTier:org-admin"
  | "isOrgAdmin"
  | "isManager";

export const LEGACY_HELPERS: readonly LegacyHelper[] = [
  "getSpaceForReader",
  "canEditSpace",
  "canEditSpace@create_child",
  "canContributeSpace",
  "getBoardForReader",
  "canReadBoard",
  "canEditBoard",
  "canContributeBoard",
  "folderVisibleTo",
  "folderReadable",
  "docAccessible",
  "resolveSpace",
  "resolveFolder",
  "resolveBoard",
  "resolveItem",
  "resolveDoc",
  "itemRead",
  "itemWrite",
  "createSpace",
  "canAccessTier:manager",
  "canAccessTier:hr-admin",
  "canAccessTier:org-admin",
  "isOrgAdmin",
  "isManager",
];

export type LegacyAnswer =
  | { kind: "boolean"; value: boolean }
  | { kind: "permission"; value: LegacyPermission };

/**
 * The boolean view of `legacyAnswer`, which is what the step-1 delegates in
 * space.ts, board.ts and folder.ts need: every one of those helpers returns a
 * boolean (or a row it keeps when the answer is true). A permission-shaped
 * answer reads as allowed for anything above "none", which is how the
 * resolvers' own callers (canRead) read them today.
 */
export function legacyAllows(input: LegacyInputs, helper: LegacyHelper): boolean {
  const answer = legacyAnswer(input, helper);
  return answer.kind === "boolean" ? answer.value : answer.value !== "none";
}

/** Today's answer for one helper over one world. */
export function legacyAnswer(input: LegacyInputs, helper: LegacyHelper): LegacyAnswer {
  const bool = (value: boolean): LegacyAnswer => ({ kind: "boolean", value });
  switch (helper) {
    case "getSpaceForReader":
      return bool(legacyGetSpaceForReader(input));
    case "canEditSpace":
    case "canEditSpace@create_child":
      return bool(legacyCanEditSpace(input));
    case "canContributeSpace":
      return bool(legacyCanContributeSpace(input));
    case "getBoardForReader":
    case "canReadBoard":
      return bool(legacyGetBoardForReader(input));
    case "canEditBoard":
      return bool(legacyCanEditBoard(input));
    case "canContributeBoard":
      return bool(legacyCanContributeBoard(input));
    case "folderVisibleTo":
      return bool(legacyFolderVisibleTo(input));
    case "folderReadable":
      return bool(legacyFolderReadable(input));
    case "docAccessible":
      return bool(legacyDocAccessible(input));
    case "resolveSpace":
      return { kind: "permission", value: legacyResolveSpace(input) };
    case "resolveFolder":
      return { kind: "permission", value: legacyResolveFolder(input) };
    case "resolveBoard":
      return { kind: "permission", value: legacyResolveBoard(input) };
    case "resolveItem":
      return { kind: "permission", value: legacyResolveItem(input) };
    case "resolveDoc":
      return { kind: "permission", value: legacyResolveDoc(input) };
    case "itemRead":
      return bool(legacyItemRead(input));
    case "itemWrite":
      return bool(legacyItemWrite(input));
    case "createSpace":
      return bool(legacyCreateSpace(input));
    case "canAccessTier:manager":
      return bool(legacyCanAccessTier(input, "manager"));
    case "canAccessTier:hr-admin":
      return bool(legacyCanAccessTier(input, "hr-admin"));
    case "canAccessTier:org-admin":
      return bool(legacyCanAccessTier(input, "org-admin"));
    case "isOrgAdmin":
      return bool(legacyIsOrgAdmin(input));
    case "isManager":
      return bool(legacyIsManager(input));
    default:
      return bool(false);
  }
}

// ── The same world, as AccessFacts ────────────────────────────────

function viewerFromLegacy(i: LegacyInputs): Viewer {
  const orgRole = orgRoleOf({ accessLevel: i.accessLevel });
  return {
    userId: i.userId,
    organizationId: i.organizationId,
    orgRole,
    isAgent: isAgentOf(i.accessLevel),
    adminScopes: orgRole === "OWNER" ? ["billing", "security"] : [],
    status: (i.status ?? "ACTIVE") as Viewer["status"],
    peopleTeam: i.peopleTeam === true || isSeededPeopleTeam(i.accessLevel),
    reportTree: new Set(i.hasReports ? ["someone-who-reports-to-me"] : []),
    departmentId: null,
    officeId: null,
    roleId: null,
    teamIds: [],
    tagIds: [],
  };
}

function roleFromSpaceRole(role: SpaceRoleValue): ObjectRole {
  if (role === "OWNER" || role === "ADMIN") return "FULL";
  if (role === "MEMBER") return "EDIT";
  return "VIEW";
}

function userGrant(objectType: ObjectType, objectId: string, userId: string, role: ObjectRole): GrantFact {
  return { objectType, objectId, subjectType: "USER", subjectId: userId, role, expiresAt: null };
}

function everyoneGrant(objectType: ObjectType, objectId: string, role: ObjectRole): GrantFact {
  return { objectType, objectId, subjectType: "EVERYONE", subjectId: null, role, expiresAt: null };
}

function spaceLink(space: LegacySpace): ChainLink {
  return {
    type: "space",
    id: space.id,
    name: space.name ?? "Space",
    ownerId: space.ownerId,
    restricted: false, // Space PRIVATE and WORKSPACE are the same at read time today
    findable: space.visibility === "ORG",
    archived: space.archived === true,
  };
}

function folderLink(folder: LegacyFolder): ChainLink {
  return {
    type: "folder",
    id: folder.id,
    name: folder.name ?? "Folder",
    ownerId: folder.ownerId,
    restricted: folder.visibility === "PRIVATE",
    findable: false,
    archived: folder.archived === true,
  };
}

function listLink(board: LegacyBoard): ChainLink {
  return {
    type: "list",
    id: board.id,
    name: board.name ?? "List",
    ownerId: board.ownerId,
    restricted: board.visibility === "PRIVATE",
    findable: false,
    archived: board.archived === true,
  };
}

function grantsFor(i: LegacyInputs): GrantFact[] {
  const out: GrantFact[] = [];
  if (i.space) {
    if (i.space.memberRole) {
      out.push(userGrant("space", i.space.id, i.userId, roleFromSpaceRole(i.space.memberRole)));
    }
    if (i.space.visibility === "ORG") {
      // Spec 3.1: the role is what settings.defaultPermission maps to, not a
      // hard-coded EDIT. Hard-coding it here made the harness's engine half
      // diverge from the production loadFacts it claims to mirror, so the
      // report under-reported on exactly the Spaces where the toggle matters.
      out.push(everyoneGrant("space", i.space.id, roleFromDefaultPermission(i.space.settings)));
    }
  }
  if (i.folder) {
    if (i.folder.memberRole) {
      out.push(userGrant("folder", i.folder.id, i.userId, roleFromSpaceRole(i.folder.memberRole)));
    }
    if (i.folder.ancestorMemberRole && i.folder.parentFolderId) {
      out.push(
        userGrant("folder", i.folder.parentFolderId, i.userId, roleFromSpaceRole(i.folder.ancestorMemberRole)),
      );
    }
  }
  if (i.board) {
    if (i.board.memberRole) {
      out.push(userGrant("list", i.board.id, i.userId, roleFromSpaceRole(i.board.memberRole)));
    }
    if (i.board.visibility === "ORG") out.push(everyoneGrant("list", i.board.id, "VIEW"));
  }
  return out;
}

/**
 * The chain above a Folder, a List, an Item or a Doc, nearest first.
 *
 * For a Doc this has to mirror facts.ts `anchorChain`, which returns
 * `[objectAsLink(anchor), ...anchor.chain]`: the ANCHOR ITSELF is the first
 * link. Dropping it (which is what this function used to do for every anchor
 * type) made the harness report an answer the real engine never gives: a Doc
 * on a PRIVATE board looked unrestricted because the board was not in the
 * chain, a Doc on a FOLDER the viewer held a row on looked inaccessible
 * because the folder was not in the chain, and a Doc on a WORKSPACE board the
 * viewer held a BoardMember grant on resolved to none instead of EDIT. The
 * doc gates are the whole reason doc-access.ts exists, so a harness that
 * cannot measure them is worse than no harness.
 */
function folderChainLinks(i: LegacyInputs): ChainLink[] {
  const out: ChainLink[] = [];
  if (!i.folder) return out;
  out.push(folderLink(i.folder));
  if (i.folder.parentFolderId) out.push(parentFolderLink(i.folder.parentFolderId));
  return out;
}

function parentFolderLink(id: string): ChainLink {
  return {
    type: "folder",
    id,
    name: "Parent folder",
    ownerId: null,
    restricted: false,
    findable: false,
    archived: false,
  };
}

function chainFor(i: LegacyInputs, target: ObjectType): ChainLink[] {
  const chain: ChainLink[] = [];

  if (target === "doc") {
    // The anchor is a link, then its own chain, then the Space.
    const anchor = i.doc?.anchor.entityType ?? null;
    if (anchor === "SPACE") {
      if (i.space) chain.push(spaceLink(i.space));
      return chain;
    }
    if (anchor === "FOLDER") {
      chain.push(...folderChainLinks(i));
      if (i.space) chain.push(spaceLink(i.space));
      return chain;
    }
    if (anchor === "BOARD" || anchor === "BOARD_ITEM" || anchor === "TASK" || anchor === "BOARD_ROW") {
      if (anchor !== "BOARD" && i.item) {
        // A doc on a task hangs off the Item, whose chain starts at the List.
        chain.push({
          type: "item",
          id: i.item.id,
          name: "Task",
          ownerId: null,
          restricted: false,
          findable: false,
          archived: false,
        });
      }
      if (i.board) chain.push(listLink(i.board));
      if (i.board?.folderId) chain.push(...folderChainLinks(i));
      if (i.space) chain.push(spaceLink(i.space));
      return chain;
    }
    // NOTEPAD (rule 3) and unknown anchor types carry no chain, exactly as
    // loadDocFacts and anchorChain return.
    return chain;
  }

  if (target === "item" && i.board) chain.push(listLink(i.board));
  if ((target === "item" || target === "list") && i.board?.folderId) {
    chain.push(...folderChainLinks(i));
  }
  if (target === "folder" && i.folder?.parentFolderId) {
    chain.push(parentFolderLink(i.folder.parentFolderId));
  }
  if (target !== "space" && i.space) chain.push(spaceLink(i.space));
  return chain;
}

function relationshipsFor(i: LegacyInputs, target: ObjectType): Relationships {
  const rel = emptyRelationships();
  if (target === "item" && i.item) {
    rel.isAssignee = i.item.ownerId === i.userId || i.item.assigneeIds.includes(i.userId);
  }
  if (target === "list" && i.item) {
    rel.hasAssignedItemInside = i.item.assigneeIds.includes(i.userId) || i.item.ownerId === i.userId;
  }
  return rel;
}

function objectFor(i: LegacyInputs, target: ObjectType): ObjectFacts {
  const blank = (id: string, organizationId: string | null): ObjectFacts => ({
    type: target,
    id,
    organizationId,
    ownerId: null,
    restricted: false,
    findable: false,
    archived: false,
  });

  if (target === "space") {
    if (!i.space) return blank("missing-space", null);
    return {
      ...blank(i.space.id, i.space.organizationId),
      ownerId: i.space.ownerId,
      findable: i.space.visibility === "ORG",
      archived: i.space.archived === true,
      name: i.space.name,
    };
  }
  if (target === "folder") {
    if (!i.folder) return blank("missing-folder", null);
    return {
      ...blank(i.folder.id, i.folder.organizationId),
      ownerId: i.folder.ownerId,
      restricted: i.folder.visibility === "PRIVATE",
      archived: i.folder.archived === true,
      name: i.folder.name,
    };
  }
  if (target === "list") {
    if (!i.board) return blank("missing-list", null);
    return {
      ...blank(i.board.id, i.board.organizationId),
      ownerId: i.board.ownerId,
      restricted: i.board.visibility === "PRIVATE",
      archived: i.board.archived === true,
      name: i.board.name,
      context: { name: i.board.name ?? "List" },
    };
  }
  if (target === "item") {
    if (!i.item) return blank("missing-item", null);
    // Item.ownerId is the DRI, not a creator: rule 5 must not fire on it.
    return { ...blank(i.item.id, i.item.organizationId) };
  }
  if (target === "doc") {
    if (!i.doc) return blank("missing-doc", null);
    const anchor = i.doc.anchor;
    if (anchor.entityType === "NOTEPAD") {
      return {
        ...blank(i.doc.id, i.doc.organizationId),
        ownerId: i.doc.createdById,
        ownerOnly: "notepad",
        ownerOnlySubjectId: anchor.entityId,
      };
    }
    return { ...blank(i.doc.id, i.doc.organizationId), ownerId: i.doc.createdById };
  }
  return blank("unknown", null);
}

/**
 * The same world, as the engine sees it. Every derivation here is the one
 * loadFacts makes against today's tables (facts.ts), which is what makes the
 * two halves comparable.
 */
export function factsFromLegacy(i: LegacyInputs, target: ObjectType): AccessFacts {
  const grants = grantsFor(i);
  // facts.ts loadDocFacts tests `!doc.entityType || !doc.entityId`, so a row
  // with an entityType and no entityId is standalone there. Testing only
  // `entityType === null` here scored that row differently from production.
  if (target === "doc" && i.doc && (!i.doc.anchor.entityType || !i.doc.anchor.entityId)) {
    // A standalone doc keeps the org-wide read it has today.
    grants.push(everyoneGrant("doc", i.doc.id, "VIEW"));
  }
  return {
    viewer: viewerFromLegacy(i),
    object: objectFor(i, target),
    chain: chainFor(i, target),
    grants,
    relationships: relationshipsFor(i, target),
    org: {
      // The parity job diffs against what today's code enforces, not against
      // the section 8 defaults: three of those defaults are deliberately more
      // permissive than today and would manufacture mismatches.
      access: TODAY_EQUIVALENT_ACCESS_SETTINGS,
      activeModules: new Set(["chat", "tables"]),
      apps: {},
      peopleTeamIds: [],
    },
    now: 0,
  };
}

// ── The engine's answer for the same helper ───────────────────────

/** What each legacy helper becomes, per spec section 14's "step 1 wrapper". */
export const HELPER_TO_ACTION: Record<LegacyHelper, { action: Action; target: ObjectType } | null> = {
  getSpaceForReader: { action: "view", target: "space" },
  canEditSpace: { action: "manage", target: "space" },
  // D15: creating a List or a Folder is content, not management.
  "canEditSpace@create_child": { action: "create_child", target: "space" },
  canContributeSpace: { action: "edit", target: "space" },
  getBoardForReader: { action: "view", target: "list" },
  canReadBoard: { action: "view", target: "list" },
  canEditBoard: { action: "manage", target: "list" },
  canContributeBoard: { action: "edit", target: "list" },
  folderVisibleTo: { action: "view", target: "folder" },
  folderReadable: { action: "view", target: "folder" },
  docAccessible: { action: "view", target: "doc" },
  resolveSpace: { action: "view", target: "space" },
  resolveFolder: { action: "view", target: "folder" },
  resolveBoard: { action: "view", target: "list" },
  resolveItem: { action: "view", target: "item" },
  resolveDoc: { action: "view", target: "doc" },
  itemRead: { action: "view", target: "item" },
  itemWrite: { action: "edit", target: "item" },
  createSpace: null,
  "canAccessTier:manager": null,
  "canAccessTier:hr-admin": null,
  "canAccessTier:org-admin": null,
  isOrgAdmin: null,
  isManager: null,
};

/** access.ts's three-rung ladder, from a Decision. */
function permissionFromDecision(decision: Decision): LegacyPermission {
  if (decision.role === "none") return "none";
  if (decision.via === "org-admin") return "admin";
  if (decision.role === "FULL" || decision.role === "EDIT") return "edit";
  return "read";
}

/** The engine's answer for one helper over one world. */
export function engineAnswer(i: LegacyInputs, helper: LegacyHelper): LegacyAnswer {
  const bool = (value: boolean): LegacyAnswer => ({ kind: "boolean", value });

  // The three tier helpers and the two ladder predicates answer from the
  // viewer alone: no object, no facts.
  const viewer = viewerFromLegacy(i);
  const admin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
  if (helper === "isOrgAdmin") return bool(admin);
  if (helper === "isManager") {
    // Spec 10 step 1: isManager = hasReports or peopleTeam or Admin.
    return bool(admin || viewer.peopleTeam === true || (viewer.reportTree?.size ?? 0) > 0);
  }
  if (helper === "createSpace") {
    const orgFacts = factsFromLegacy(i, "space");
    return bool(decide({ ...orgFacts, orgAction: "create_space" }, "view").allowed);
  }
  if (helper.startsWith("canAccessTier:")) {
    const tier = helper.slice("canAccessTier:".length);
    if (tier === "org-admin") return bool(admin);
    if (tier === "hr-admin") return bool(admin || viewer.peopleTeam === true);
    return bool(admin || viewer.peopleTeam === true || (viewer.reportTree?.size ?? 0) > 0);
  }

  const mapping = HELPER_TO_ACTION[helper];
  if (!mapping) return bool(false);
  const facts = factsFromLegacy(i, mapping.target);
  const decision = decide(facts, mapping.action);

  if (helper.startsWith("resolve")) {
    return { kind: "permission", value: permissionFromDecision(decision) };
  }
  if (helper === "canEditSpace@create_child") return bool(decision.allowed);
  return bool(decision.allowed);
}

// ── Comparing ─────────────────────────────────────────────────────

export interface Mismatch {
  caseId: string;
  helper: LegacyHelper;
  legacy: LegacyAnswer;
  engine: LegacyAnswer;
  description: string;
  /** Set when a classifier recognised the difference. */
  expected?: ExpectedMismatch;
}

export interface ParityCase {
  id: string;
  description: string;
  helper: LegacyHelper;
  input: LegacyInputs;
  /**
   * For the suite only: which expectation key this case is meant to hit. The
   * classifier does not read it; the test asserts on it, which is what keeps a
   * classifier from quietly swallowing a case it was not written for.
   */
  expectKey?: string;
}

function sameAnswer(a: LegacyAnswer, b: LegacyAnswer): boolean {
  return a.kind === b.kind && a.value === b.value;
}

/** Everything a classifier gets to look at. */
export interface MismatchContext {
  helper: LegacyHelper;
  input: LegacyInputs;
  legacy: LegacyAnswer;
  engine: LegacyAnswer;
}

const PERMISSION_RANK: Record<LegacyPermission, number> = { none: 0, read: 1, edit: 2, admin: 3 };

function answerRank(answer: LegacyAnswer): number {
  return answer.kind === "boolean" ? (answer.value ? 1 : 0) : PERMISSION_RANK[answer.value];
}

/** Does the engine give MORE than today? */
function widens(ctx: MismatchContext): boolean {
  return answerRank(ctx.engine) > answerRank(ctx.legacy);
}

/** Does the engine give LESS than today? */
function narrows(ctx: MismatchContext): boolean {
  return answerRank(ctx.engine) < answerRank(ctx.legacy);
}

const RESOLVER_HELPERS: ReadonlySet<LegacyHelper> = new Set<LegacyHelper>([
  "resolveSpace",
  "resolveFolder",
  "resolveBoard",
  "resolveItem",
  "resolveDoc",
]);

const READ_HELPERS: ReadonlySet<LegacyHelper> = new Set<LegacyHelper>([
  "getBoardForReader",
  "canReadBoard",
  "itemRead",
]);

const CONTAINER_GATES: ReadonlySet<LegacyHelper> = new Set<LegacyHelper>([
  "getSpaceForReader",
  "canEditSpace",
  "canContributeSpace",
  "getBoardForReader",
  "canReadBoard",
  "canEditBoard",
  "canContributeBoard",
]);

const KNOWN_DOC_ANCHORS: ReadonlySet<string> = new Set([
  "SPACE",
  "FOLDER",
  "BOARD",
  "BOARD_ITEM",
  "TASK",
  "BOARD_ROW",
  "NOTEPAD",
]);

function isAdmin(ctx: MismatchContext): boolean {
  return legacyIsAdminLevel(ctx.input.accessLevel);
}

function crossOrg(i: LegacyInputs): boolean {
  const rows = [i.space, i.folder, i.board, i.item, i.doc];
  return rows.some((row) => !!row && row.organizationId !== i.organizationId);
}

/**
 * The classifier. A predicate over (helper, world, old answer, new answer),
 * NOT a lookup on a test-case name.
 *
 * This is load-bearing for step 2. The nightly job samples real (user, object)
 * pairs, so its case ids are things like "u_123:board_456" and can never match
 * a hand-written literal: keying the expectations by case id, which is what
 * this file used to do, filed every known and intended difference under
 * `unexpected` and made "zero unexpected mismatches for a week" unreachable by
 * construction. Order matters, most specific first.
 */
const CLASSIFIERS: ReadonlyArray<{ key: string; matches: (ctx: MismatchContext) => boolean }> = [
  // ── Rule 1 ──
  {
    key: "rule-1-status-follows-auth-not-the-literal-spec",
    matches: (ctx) => ctx.input.status === "INACTIVE" && narrows(ctx),
  },
  {
    key: "pivot-container-gates-do-not-scope-by-org",
    matches: (ctx) => CONTAINER_GATES.has(ctx.helper) && crossOrg(ctx.input) && narrows(ctx),
  },
  {
    key: "missing-access-level-is-a-guest",
    matches: (ctx) => (ctx.input.accessLevel ?? null) === null && narrows(ctx),
  },

  // ── Rule 12's principal caps ──
  {
    key: "agent-cap-clamps-full-to-edit",
    matches: (ctx) => ctx.input.accessLevel === "AGENT" && narrows(ctx),
  },

  // ── Org verbs and tiers ──
  { key: "d15-create-child-at-edit", matches: (ctx) => ctx.helper === "canEditSpace@create_child" },
  { key: "space-create-not-manager-tier", matches: (ctx) => ctx.helper === "createSpace" },
  {
    key: "tier-hr-admin-is-people-team",
    matches: (ctx) => ctx.helper === "canAccessTier:hr-admin",
  },
  {
    key: "tier-manager-is-report-tree",
    matches: (ctx) => ctx.helper === "canAccessTier:manager" || ctx.helper === "isManager",
  },

  // ── The archived cap, which nothing in the codebase knows about ──
  {
    key: "archived-cap-has-no-equivalent-today",
    matches: (ctx) =>
      narrows(ctx) &&
      (ctx.input.space?.archived === true ||
        ctx.input.folder?.archived === true ||
        ctx.input.board?.archived === true),
  },

  // ── Notepad: rule 3 precedes rule 4 ──
  {
    key: "audit-notepad-admin-read-around",
    matches: (ctx) =>
      ctx.input.doc?.anchor.entityType === "NOTEPAD" &&
      ctx.input.doc.anchor.entityId !== ctx.input.userId &&
      isAdmin(ctx) &&
      narrows(ctx),
  },

  // ── Docs: the open defaults ──
  {
    key: "pivot-doc-unknown-anchor-falls-open",
    matches: (ctx) => {
      const anchor = ctx.input.doc?.anchor;
      if (!anchor?.entityType || !anchor.entityId) return false;
      return !KNOWN_DOC_ANCHORS.has(anchor.entityType) && narrows(ctx);
    },
  },

  // ── Folders ──
  {
    key: "pivot-folder-readable-admin-without-row",
    matches: (ctx) => ctx.helper === "folderReadable" && isAdmin(ctx) && !ctx.input.folder && narrows(ctx),
  },
  {
    key: "pivot-folder-visible-to-ignores-folder-grant",
    matches: (ctx) =>
      ctx.helper === "folderVisibleTo" &&
      ctx.input.folder?.visibility === "PRIVATE" &&
      !!ctx.input.folder.memberRole &&
      widens(ctx),
  },
  {
    key: "audit-1.6-c-folder-grantee-board",
    matches: (ctx) =>
      (READ_HELPERS.has(ctx.helper) || RESOLVER_HELPERS.has(ctx.helper)) &&
      ctx.input.folder?.visibility === "PRIVATE" &&
      (!!ctx.input.folder.memberRole || !!ctx.input.folder.ancestorMemberRole) &&
      widens(ctx),
  },

  // ── Restricted Lists, and who pierces them ──
  {
    key: "d7-space-owner-pierce-restricted-list",
    matches: (ctx) =>
      ctx.input.board?.visibility === "PRIVATE" &&
      ctx.input.board.ownerId !== ctx.input.userId &&
      ctx.input.space?.memberRole === "OWNER" &&
      narrows(ctx),
  },
  {
    key: "audit-1.6-b-space-admin-private-board",
    matches: (ctx) =>
      ctx.input.board?.visibility === "PRIVATE" &&
      ctx.input.board.ownerId !== ctx.input.userId &&
      ctx.input.space?.memberRole === "ADMIN" &&
      narrows(ctx),
  },

  // ── Boards ──
  {
    key: "board-owner-or-org-visibility-inside-a-private-folder",
    matches: (ctx) =>
      READ_HELPERS.has(ctx.helper) &&
      ctx.input.folder?.visibility === "PRIVATE" &&
      ctx.input.folder.ownerId !== ctx.input.userId &&
      !ctx.input.folder.memberRole &&
      (ctx.input.board?.ownerId === ctx.input.userId || ctx.input.board?.visibility === "ORG") &&
      widens(ctx),
  },
  {
    key: "board-member-admin-manages-a-non-private-board",
    matches: (ctx) =>
      ctx.helper === "canEditBoard" &&
      (ctx.input.board?.memberRole === "OWNER" || ctx.input.board?.memberRole === "ADMIN") &&
      ctx.input.board?.visibility !== "PRIVATE" &&
      widens(ctx),
  },
  {
    key: "audit-1.6-a-direct-board-grant",
    matches: (ctx) => RESOLVER_HELPERS.has(ctx.helper) && !!ctx.input.board?.memberRole && widens(ctx),
  },
  {
    key: "audit-1.6-e-guest-owns-item",
    matches: (ctx) =>
      ctx.input.board?.memberRole === "GUEST" &&
      (ctx.input.item?.ownerId === ctx.input.userId ||
        !!ctx.input.item?.assigneeIds.includes(ctx.input.userId)) &&
      widens(ctx),
  },

  // ── Spaces ──
  {
    key: "container-owner-without-a-member-row",
    matches: (ctx) =>
      widens(ctx) &&
      ((ctx.input.space?.ownerId === ctx.input.userId && !ctx.input.space.memberRole) ||
        (ctx.input.folder?.ownerId === ctx.input.userId && !ctx.input.folder.memberRole)),
  },
  {
    key: "audit-1.6-f-org-space-non-member-contributes",
    matches: (ctx) =>
      ctx.input.space?.visibility === "ORG" && !ctx.input.space.memberRole && widens(ctx),
  },
  {
    key: "space-member-maps-to-edit",
    matches: (ctx) =>
      (RESOLVER_HELPERS.has(ctx.helper) || ctx.helper === "canEditSpace") &&
      ctx.input.space?.memberRole === "MEMBER" &&
      widens(ctx),
  },
];

/**
 * Which known, intended difference is this? Undefined means nobody decided on
 * it, which is what `unexpected` counts.
 */
export function classifyMismatch(ctx: MismatchContext): ExpectedMismatch | undefined {
  for (const classifier of CLASSIFIERS) {
    if (!classifier.matches(ctx)) continue;
    return EXPECTED_MISMATCHES[classifier.key];
  }
  return undefined;
}

/**
 * The one function the nightly job calls: old answer, new answer, and the
 * difference when they disagree.
 */
export function compareDecisions(testCase: ParityCase): Mismatch | null {
  const legacy = legacyAnswer(testCase.input, testCase.helper);
  const engine = engineAnswer(testCase.input, testCase.helper);
  if (sameAnswer(legacy, engine)) return null;
  return {
    caseId: testCase.id,
    helper: testCase.helper,
    legacy,
    engine,
    description: testCase.description,
    expected: classifyMismatch({ helper: testCase.helper, input: testCase.input, legacy, engine }),
  };
}

export interface ParityReport {
  total: number;
  agreed: number;
  expected: Mismatch[];
  unexpected: Mismatch[];
  /** Expectations no case exercised: a stale entry, or a lost test. */
  unusedExpectations: string[];
}

export function runParity(cases: ParityCase[]): ParityReport {
  const expected: Mismatch[] = [];
  const unexpected: Mismatch[] = [];
  const seen = new Set<string>();

  for (const testCase of cases) {
    const mismatch = compareDecisions(testCase);
    if (!mismatch) continue;
    if (mismatch.expected) {
      expected.push(mismatch);
      seen.add(mismatch.expected.key);
    } else {
      unexpected.push(mismatch);
    }
  }

  const unusedExpectations = Object.keys(EXPECTED_MISMATCHES).filter((key) => !seen.has(key));
  return {
    total: cases.length,
    agreed: cases.length - expected.length - unexpected.length,
    expected,
    unexpected,
    unusedExpectations,
  };
}

// ── The expectations file ─────────────────────────────────────────

export interface ExpectedMismatch {
  /** The classifier that recognises this difference. */
  key: string;
  /** Where this difference was decided. */
  source: string;
  /** Why the new answer is the one we want. */
  reason: string;
  /** "widens" or "narrows" access relative to today. */
  direction: "widens" | "narrows";
}

/**
 * Every difference between today's answer and the engine's that is known and
 * intended. Three groups:
 *
 *   (1) the audit's table 1.6 rows (access-model.md:137-147) plus the NOTEPAD
 *       admin read-around at access-model.md:107, which are cases where TWO of
 *       today's systems already disagree with each other, so any single answer
 *       changes one of them;
 *   (2) the decisions this spec makes on purpose, listed by name in step 2; and
 *   (3) differences found by running the two halves against each other, which
 *       nobody had written down.
 *
 * An entry here is a promise that the change is wanted, not a licence to stop
 * looking: `runParity` still reports it, and the step-1 delegates must keep
 * TODAY's answer at each call site until the week of zero unexpected
 * mismatches has passed.
 */
export const EXPECTED_MISMATCHES: Record<string, ExpectedMismatch> = {
  // ── Group 1: the audit's table 1.6 ──
  "audit-1.6-a-direct-board-grant": {
    key: "audit-1.6-a-direct-board-grant",
    source: "access-model.md:141 (audit 1.6 row 1); spec 10 step 1 'Broken #1 and #2 close'",
    reason:
      "A user added straight to a List through the share dialog reads it in the API (board.ts:623-627) and 404s on the page (access.ts:201-227 never reads BoardMember). The engine gives one answer: the direct grant counts, which is what the dialog already promises.",
    direction: "widens",
  },
  "audit-1.6-b-space-admin-private-board": {
    key: "audit-1.6-b-space-admin-private-board",
    source: "access-model.md:142 (audit 1.6 row 2)",
    reason:
      "A Space ADMIN sees a PRIVATE board's page (resolveBoard demotes only 'read') but its items API 404s (board.ts:645-651 accepts Space OWNER only). Under the spec a Restricted List is not pierced by an ancestor at all (D7), and the G5 backfill writes the explicit grants that preserve real reach.",
    direction: "narrows",
  },
  "audit-1.6-c-folder-grantee-board": {
    key: "audit-1.6-c-folder-grantee-board",
    source: "access-model.md:143 (audit 1.6 row 3)",
    reason:
      "A FolderMember grantee opens a board inside a PRIVATE folder on the page but its API 404s: board.ts:632-637 checks folder.ownerId only and never FolderMember. doc-access.ts:27-39 patched this for Docs; Items were never patched. Rule 10 inherits the folder grant for both.",
    direction: "widens",
  },
  "space-member-maps-to-edit": {
    key: "space-member-maps-to-edit",
    source: "access-model.md:144 (audit 1.6 row 4); spec 3.1's enum mapping",
    reason:
      "A Space MEMBER writes tasks (canContributeBoard, board.ts:742-746) but every resolver calls them 'read', so they cannot share a folder. SpaceRole.MEMBER maps to EDIT once, everywhere. The audit filed this under resolveFolder; it is in fact all five resolvers plus canEditSpace, which is why the classifier is cased on the MEMBER row rather than on one helper.",
    direction: "widens",
  },
  "audit-1.6-e-guest-owns-item": {
    key: "audit-1.6-e-guest-owns-item",
    source: "access-model.md:145 (audit 1.6 row 5)",
    reason:
      "resolveItem gives an item's owner edit (access.ts:280-282) while canContributeBoard excludes a GUEST board grant. Rule 9's assignee rule fires on the Item for anyone assigned, Guest included, capped at EDIT.",
    direction: "widens",
  },
  "audit-1.6-f-org-space-non-member-contributes": {
    key: "audit-1.6-f-org-space-non-member-contributes",
    source: "access-model.md:146 (audit 1.6 row 6)",
    reason:
      "An ORG-visibility Space is read-only for non-members today (canContributeBoard needs a SpaceMember row) while the resolver calls it read. Visibility.ORG becomes an EVERYONE grant at the role settings.defaultPermission maps to, default EDIT (spec 3.1), so an org-open Space is genuinely open.",
    direction: "widens",
  },
  "audit-notepad-admin-read-around": {
    key: "audit-notepad-admin-read-around",
    source: "access-model.md:107; spec 11 invariant 7; spec 14 line 1107",
    reason:
      "access.ts:242 returns 'admin' BEFORE the NOTEPAD check at :248, so an org admin reads someone else's notepad through the resolver, while doc-access.ts:74-81 denies it 'regardless of access level'. Rule 3 precedes rule 4: owner only, no read-around.",
    direction: "narrows",
  },

  // ── Group 2: the decisions the spec makes on purpose ──
  "d15-create-child-at-edit": {
    key: "d15-create-child-at-edit",
    source: "spec 3.3 (decision D15), spec 10 step 2",
    reason:
      "Creating a List or a Folder is content, not management: create_child needs EDIT on the parent. Today POST /api/boards:119 and POST /api/folders:60 call canEditSpace (Space OWNER/ADMIN).",
    direction: "widens",
  },
  "d7-space-owner-pierce-restricted-list": {
    key: "d7-space-owner-pierce-restricted-list",
    source: "spec 4.1 example E (decision D7), spec 10 step 2",
    reason:
      "A Space OWNER pierces a PRIVATE board today (board.ts:645-651). Restricted stops inheritance for everyone but the object's owner and org Owners/Admins; the G5 backfill writes explicit FULL rows so nothing disappears on flip day.",
    direction: "narrows",
  },
  "tier-manager-is-report-tree": {
    key: "tier-manager-is-report-tree",
    source: "spec 2.2, spec 10 step 1 (isManager = hasReports or peopleTeam or Admin)",
    reason:
      "Today MANAGER, TEAM_LEAD, DIRECTOR, VP, C_LEVEL and HR are 'manager' by rung (access-tiers.ts:14-17). Manager becomes a fact about the org chart, so a DIRECTOR or TEAM_LEAD with no reports loses the tier and a plain EMPLOYEE with reports gains it. This covers both surfaces of the same rule: the rail tier and the isManager predicate api-helpers.ts exposes.",
    direction: "narrows",
  },
  "tier-hr-admin-is-people-team": {
    key: "tier-hr-admin-is-people-team",
    source: "spec 2.1 (People team), spec 10 step 4.2 (People team seeded with HR users)",
    reason:
      "The 'hr-admin' tier is HR plus the two admin levels today. It becomes the People team, seeded from HR users, so the answer is the same for an HR user and different for anyone an admin later adds to the team.",
    direction: "widens",
  },
  "archived-cap-has-no-equivalent-today": {
    key: "archived-cap-has-no-equivalent-today",
    source: "spec 3.3 ('Archived caps everyone at VIEW') and spec 4 rule 12",
    reason:
      "No gate in the codebase knows about archiving: canContributeBoard and canEditSpace answer the same for a live and an archived container. Rule 12 caps everyone at VIEW on an archived object and its descendants, sparing FULL holders so they can still restore.",
    direction: "narrows",
  },
  "space-create-not-manager-tier": {
    key: "space-create-not-manager-tier",
    source: "spec 8 toggle 1; today api/spaces/route.ts:11 MANAGER_LEVELS",
    reason:
      "Creating a Space is a manager-tier act today. Toggle 1 defaults to Everyone, so every Member creates Spaces unless an admin says otherwise.",
    direction: "widens",
  },
  "rule-1-status-follows-auth-not-the-literal-spec": {
    key: "rule-1-status-follows-auth-not-the-literal-spec",
    source: "spec 4 rule 1; auth.ts:148-156; prisma UserStatus",
    reason:
      "No gate in the codebase reads User.status, so rule 1's status clause is new either way. Spec rule 1 words it as 'status not ACTIVE or PROBATION', which taken literally 404s ON_LEAVE, PIP and NOTICE_PERIOD employees out of the whole product and contradicts auth.ts, which signs all five in and says they 'are still employed and keep their access'. The engine therefore denies exactly the set that cannot hold a session (INACTIVE, plus soft-deleted), which is a difference from the legacy helpers (they answer for an INACTIVE row) and a deliberate deviation from the spec's wording.",
    direction: "narrows",
  },

  // ── Group 3: found by running the two halves against each other ──
  "pivot-container-gates-do-not-scope-by-org": {
    key: "pivot-container-gates-do-not-scope-by-org",
    source:
      "space.ts:194-204 and board.ts:605-665 select organizationId and never compare it; spec 4 rule 1",
    reason:
      "getSpaceForReader, getBoardForReader, canEditSpace, canContributeSpace, canEditBoard and canContributeBoard apply no org filter: an ORG-visibility Space in another tenant reads true, and the caller is trusted to check (api/spaces/[id]:31 does, most do not). Rule 1 scopes first and answers 404. The delegates pass the loaded row's own organizationId into the struct precisely so the pivot cannot start enforcing this early.",
    direction: "narrows",
  },
  "pivot-doc-unknown-anchor-falls-open": {
    key: "pivot-doc-unknown-anchor-falls-open",
    source: "doc-access.ts:46 and :87; spec 3.3 and 5.1",
    reason:
      "docAccessible returns true for a doc with no anchor and for any anchor type it does not know (LEAD and anything a future suite adds). The engine has no open default: an unrecognised anchor resolves to none. Widening a doc gate by accident is the one direction that must never ship quietly, so the open default is preserved verbatim until each anchor type has a rule.",
    direction: "narrows",
  },
  "pivot-folder-visible-to-ignores-folder-grant": {
    key: "pivot-folder-visible-to-ignores-folder-grant",
    source: "folder.ts:15-29 (its own comment says so); spec 4 rule 6",
    reason:
      "folderVisibleTo hides a PRIVATE folder from a FolderMember grantee, which is why the scoped sidebar path routes around it instead of through it. Rule 6 honours the direct grant, so the same folder becomes visible. This is the pure sibling of audit 1.6 row c.",
    direction: "widens",
  },
  "pivot-folder-readable-admin-without-row": {
    key: "pivot-folder-readable-admin-without-row",
    source: "folder.ts:176; spec 4 rule 1 and invariant 1",
    reason:
      "folderReadable answers true for an org admin BEFORE it loads the folder, so it answers true for a folder id that does not exist or belongs to another tenant. Rule 1 runs before the Admin rule and makes both a 404. The delegate keeps the early true; its loader still fetches the row, so the flip needs no new query.",
    direction: "narrows",
  },
  "agent-cap-clamps-full-to-edit": {
    key: "agent-cap-clamps-full-to-edit",
    source: "spec 2.4 ('role selects clamp Full access to Can edit'), spec 4 rule 12",
    reason:
      "Today AGENT differs from EMPLOYEE in exactly one place (tasks.delete in the permission matrix), so an AGENT who is a SpaceMember OWNER or a board's owner manages it like anyone else. Rule 12 clamps an Agent to EDIT, so every FULL-level action (manage, share, restrict, findable, move, transfer, delete) goes away for them. Nobody had written this down.",
    direction: "narrows",
  },
  "missing-access-level-is-a-guest": {
    key: "missing-access-level-is-a-guest",
    source: "org-role.ts:40 (spec 2.1's '(none) -> Guest' row); route-guard.ts's `?? EMPLOYEE`",
    reason:
      "A viewer with no accessLevel is an EMPLOYEE to route-guard.ts and a GUEST to orgRoleOf, and a Guest carries the rule-8 exclusion from EVERYONE grants plus the rule-12 caps. viewer.ts re-reads User.accessLevel for a token whose claim is missing so a stale session is not silently demoted, but a row with a genuinely null level does resolve as a Guest.",
    direction: "narrows",
  },
  "container-owner-without-a-member-row": {
    key: "container-owner-without-a-member-row",
    source: "space.ts:210-217 reads only SpaceMember; spec 4 rule 5",
    reason:
      "canEditSpace and canContributeSpace read the SpaceMember table and nothing else, so a Space whose ownerId is the viewer but which has no OWNER member row is not manageable by its own owner. Rule 5 gives the object's ownerId FULL. This is a repair, but it is still a widening and it was not in the audit's list.",
    direction: "widens",
  },
  "board-owner-or-org-visibility-inside-a-private-folder": {
    key: "board-owner-or-org-visibility-inside-a-private-folder",
    source: "board.ts:632-637 (the private-folder cascade runs before :640 and :644)",
    reason:
      "getBoardForReader's private-folder cascade returns false before it ever reaches the ORG-visibility branch or the board's own owner check, so a board you OWN inside someone else's PRIVATE folder is invisible to you, and so is an ORG-visibility board in one. Rule 10 stops the walk at the restricted folder and rule 5 still gives the board's owner FULL, so both come back. Audit 1.6 row c covered only the FolderMember grantee.",
    direction: "widens",
  },
  "board-member-admin-manages-a-non-private-board": {
    key: "board-member-admin-manages-a-non-private-board",
    source: "board.ts:686-704: the BoardMember OWNER/ADMIN branch sits INSIDE the PRIVATE case",
    reason:
      "canEditBoard consults BoardMember only for a PRIVATE board; on a WORKSPACE or ORG board it goes straight to canEditSpace, so a BoardMember ADMIN manages a private List and not a public one. Rule 6 maps SpaceRole.ADMIN to FULL wherever the row is.",
    direction: "widens",
  },
};

/**
 * Differences the pivot also preserves but which CANNOT be expressed as a
 * ParityCase, because the harness's LegacyInputs has no field for them and the
 * helper is not in the LegacyHelper union. They are recorded here so the
 * expectations file is the whole list rather than only the testable part; the
 * step-2 nightly job has to reach them through their own call sites.
 */
export const UNMODELLED_DIFFERENCES: Record<string, ExpectedMismatch> = {
  "permission-matrix-stays-authoritative": {
    key: "permission-matrix-stays-authoritative",
    source: "permissions.ts:296-349, api-helpers.ts:125-147, spec 9",
    reason:
      "hasPermission, requirePermission and checkPermission still read Organization.settings.permissions. 15 of the 79 cells are enforced at 23 server call sites and a customer may have edited the matrix, so hard-coding spec section 9's gate rules now would change access for those orgs with nothing to map it back from. The matrix is not delegated at all in step 1.",
    direction: "widens",
  },
  "rail-apps-config-stays-display-only": {
    key: "rail-apps-config-stays-display-only",
    source: "rail-apps.ts:18-20 and :152-200, access-tiers.ts:9-10; spec 4 rule 2",
    reason:
      "The org Apps config (hidden, minAccess) and the catalog's requiredAccess hide rows only: every route stays reachable by URL today, and 8 of the 12 tiered app pages have no server gate at all. Rule 2 turns hidden or floored into none and 404s the route, and now reads ObjectFacts.appKey as well, so an object in a hidden app locks too. canAccessTier's delegate keeps the display-only reading; enforcement is step 3's gatePage work, not the pivot's.",
    direction: "narrows",
  },
  "rail-talk-hub-survives-its-module-being-off": {
    key: "rail-talk-hub-survives-its-module-being-off",
    source: "rail-apps.ts MODULE_HUB_SURVIVES_ON (Phase 0 step 1, spec-shell 1.4); spec 4 rule 2",
    reason:
      "The rail keeps the Talk hub visible with the Talk module OFF, because the non-module Announcements app is folded into that hub and would otherwise have no hub at all. Rule 2 and invariant 8 say a module-off hub is absent (example K), so the two disagree. The disagreement is display-only (no Talk OBJECT is reachable: rule 2 still answers none for every channel, and accessibleIds returns empty sets), and it belongs to the nav step rather than to this one, but it is recorded here so the row above cannot be read as 'the rail is unchanged'. Step 3 resolves it by moving Announcements out of the Talk hub or by exempting the hub explicitly in APP_RULES.",
    direction: "widens",
  },
  "ungated-settings-and-app-pages": {
    key: "ungated-settings-and-app-pages",
    source: "the 14 settings pages and 11 app pages with no server gate; spec 10 step 3",
    reason:
      "Pages like /settings/permissions, /settings/members, /trash, /kudos and /announcements render for anyone signed in. The engine answers none for most viewers on those refs. Adding a gate would be a call-site edit, which step 1 forbids, so they are pre-classified here: the step-2 job must exclude them or its report drowns in known noise and the week of zero unexpected mismatches can never be reached.",
    direction: "narrows",
  },
  "use-role-loading-fallback-is-permissive": {
    key: "use-role-loading-fallback-is-permissive",
    source: "use-role.ts:17-22 and :44-50",
    reason:
      "useRole().isAdmin is true for C_LEVEL and HR on the client, a set with no server twin, and its seven matrix-backed flags fall back to isManager while the matrix loads, which is wider than the resolved answer. useRole is not delegated in step 1: doing so needs the batched access endpoint from step 3, and rewriting it from orgRole alone would drop C_LEVEL and HR from isAdmin on day one.",
    direction: "narrows",
  },
  "team-grants-have-no-store-yet": {
    key: "team-grants-have-no-store-yet",
    source: "spec 3.2 (Team and TeamMember land in step 4); types.ts Relationships",
    reason:
      "`isTeamMember` and `isTeamLead` are declared, read by rule 9's `team` branch and never set by loadFacts, because there is no Team table before step 4. Viewer.teamIds is likewise always empty, so no TEAM grant can ever match. Both are dead until the migration, and the golden cases for them inject the booleans by hand on purpose.",
    direction: "narrows",
  },
  "app-guest-shared-is-partly-unanswerable": {
    key: "app-guest-shared-is-partly-unanswerable",
    source: "spec 5.2.1 (the `guest` column); facts.ts guestHoldsSomethingFor",
    reason:
      "Spec 5.2.1 renders a `guest: \"shared\"` app row only when something of that kind is shared with the Guest. Talk channels and SOP folders have their own membership row, so the engine answers those. Docs, Tables, Forms and Library files have no per-object share table before step 4, so the question is unanswerable and decideApp keeps the permissive answer for them rather than hiding a hub a Guest legitimately needs.",
    direction: "widens",
  },
  "standalone-doc-everyone-grant-is-view-not-edit": {
    key: "standalone-doc-everyone-grant-is-view-not-edit",
    source: "doc-access.ts:46 (docAccessible returns true for an unanchored doc); spec 10 step 4.4 (G5)",
    reason:
      "An unanchored Doc is readable AND writable org-wide today, because docAccessible is the only gate on /api/docs/[id] and it falls open for a null anchor. The G5 backfill writes EVERYONE VIEW for those rows, and loadDocFacts synthesises the same VIEW today, so a Member who could edit a standalone note will be able to read it only. Unanchored Tables and Whiteboards keep EVERYONE EDIT, because /api/tables/[id] and /api/whiteboards/[id] really do allow the whole org to PATCH them.",
    direction: "narrows",
  },
};
