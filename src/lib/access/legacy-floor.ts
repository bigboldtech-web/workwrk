// The legacy floor (R11 of the one access model, decision A8).
//
// Every workspace starts under the "legacy" Private rule: a person keeps at
// least the reach they had before node-access shipped, so nothing that works
// today stops working on deploy. That reach is not re-described here. It is
// ASKED of parity.ts's exported `legacyAnswer`, the branch-for-branch
// transcription of today's helpers, over a LegacyInputs struct built from the
// very rows node-rules.ts decides over. One world, two answers: the strict
// rules and today's, and the effective role is the higher of the two.
//
// What the floor gives, per node kind:
//   folder  folderReadable -> Can view; with canEditSpace, Full access (the
//           folder management gates today).
//   list    getBoardForReader, or a FolderMember row on the List's Folder or
//           an ancestor of it (getBoardForReaderOrFolderGrantee,
//           board.ts:700-716) -> Can view; with canContributeBoard, Can edit;
//           with canEditBoard, Full access.
//   doc     docAccessible plus resolveDocRole "edit" -> Can edit, "view"
//           -> Can comment; isDocFull -> Full access. A sub-page made before
//           the workspace's cutoff keeps that answer (today every page with
//           no anchor opened to the whole org); one made after has no floor
//           and follows its parent (A6). Delta N5 is the strict narrowing.
//   canvas  whiteboardSpaceVisible -> today's myRole (owner or org admin
//           Full access, Space contributor or no Space Can edit, else Can
//           view).
//   space, table, form: the strict rules already hold today's answer.
//
// ONLY TODAY'S ROWS. The floor is today's answer from the rows that existed
// before this release (decision A8 protects EXISTING rows). A Space, Folder
// or List row written at or after the workspace's cutoff (rows.legacyBefore)
// is this release's grant and follows the new rules alone (A2: a grant on a
// container never reaches a Private item that does not name the person), so
// floorFor drops those rows before it asks parity.ts.
//
// The floor raises roles only. It never creates a path container and never
// moves a node in the tree (node-tree.ts); a panel shows floor-only reach as
// "older_rule".
//
// Pure: imports ./parity, ./types and ./org-role, plus type-only imports of
// the world shapes from ./node-rules (erased at runtime, so no cycle).

import { legacyAllows, type LegacyBoard, type LegacyFolder, type LegacyInputs, type LegacySpace } from "./parity";
import type { ObjectRole } from "./types";
import { accessLevelMirror } from "./org-role";
import type { DocSharingFact, NodeRef, NodeRows, ViewerGrants } from "./node-rules";

/** The floor's answer: a role, never OWNER (the Space rung is not a legacy concept). */
export type FloorRole = ObjectRole | "none";

/** How far the folder walks look, as today (folder.ts:188-197, legacy-facts.ts:200). */
const HOPS = 8;

// ── today's doc role, copied ─────────────────────────────────────────

export type LegacyDocRole = "edit" | "view";

/** The two org-admin levels doc-sharing.ts:38 lists. */
const LEGACY_DOC_ADMIN_LEVELS = ["COMPANY_ADMIN", "SUPER_ADMIN"];

/**
 * A pure copy of resolveDocRole, src/lib/doc-sharing.ts:51-65, because that
 * file imports prisma and this one must load in vitest. Keep it branch for
 * branch with the original: legacy-floor.test.ts checks the table.
 */
export function legacyResolveDocRole(
  entry: { restricted?: boolean; members?: Record<string, LegacyDocRole> } | undefined,
  viewer: { userId: string; accessLevel: string | null | undefined; createdById: string | null },
): LegacyDocRole | null {
  if (viewer.createdById && viewer.userId === viewer.createdById) return "edit";
  if (LEGACY_DOC_ADMIN_LEVELS.includes(viewer.accessLevel ?? "")) return "edit";
  if (!entry) return "edit";

  const listed = entry.members?.[viewer.userId];
  if (listed === "edit" || listed === "view") return listed;
  if (entry.restricted) return null;
  return "edit";
}

/** A pure copy of isDocFull, src/lib/doc-sharing.ts:73-76. */
export function legacyIsDocFull(
  viewer: { userId: string; accessLevel: string | null | undefined },
  doc: { createdById: string | null },
): boolean {
  if (doc.createdById && viewer.userId === doc.createdById) return true;
  return LEGACY_DOC_ADMIN_LEVELS.includes(viewer.accessLevel ?? "");
}

/**
 * The entry as today's code would read it for ONE person. A listing written
 * by this release carries `roles[u]`, and its `members[u]` is only the
 * rollback projection (HEAD reads members alone). The floor is today's answer
 * from today's rows, and a roles entry is not one of them, so for a person
 * holding a roles entry their members projection is dropped: otherwise a new
 * Can view grant would read back as today's commenting "view" listing.
 */
export function legacyEntryFor(entry: DocSharingFact | undefined, userId: string) {
  if (!entry) return undefined;
  const members = entry.members ? { ...entry.members } : undefined;
  if (members && entry.roles && Object.prototype.hasOwnProperty.call(entry.roles, userId)) {
    delete members[userId];
  }
  return { restricted: entry.restricted === true, members };
}

// ── LegacyInputs from the world ──────────────────────────────────────

function levelOf(grants: ViewerGrants): string {
  const v = grants.viewer;
  return accessLevelMirror(v.orgAdmin ? "ADMIN" : v.orgGuest ? "GUEST" : "MEMBER", v.isAgent);
}

function baseInputs(rows: NodeRows, grants: ViewerGrants): LegacyInputs {
  return { userId: grants.viewer.userId, organizationId: rows.organizationId, accessLevel: levelOf(grants) };
}

function legacySpace(rows: NodeRows, grants: ViewerGrants, spaceId: string | null | undefined): LegacySpace | null {
  if (!spaceId) return null;
  const s = rows.spaces.get(spaceId);
  if (!s) return null;
  return {
    id: s.id,
    organizationId: s.organizationId,
    visibility: s.visibility,
    ownerId: s.ownerId,
    memberRole: grants.space.get(s.id) ?? null,
    name: s.name,
  };
}

/** The viewer's FolderMember role on the nearest ancestor carrying one (the 8-hop walk). */
function nearestAncestorRole(rows: NodeRows, grants: ViewerGrants, parentId: string | null) {
  let cursor = parentId;
  for (let hops = 0; cursor && hops < HOPS; hops += 1) {
    const parent = rows.folders.get(cursor);
    if (!parent) return null;
    const role = grants.folder.get(parent.id);
    if (role) return role;
    cursor = parent.parentFolderId;
  }
  return null;
}

function legacyFolder(rows: NodeRows, grants: ViewerGrants, folderId: string | null | undefined): LegacyFolder | null {
  if (!folderId) return null;
  const f = rows.folders.get(folderId);
  if (!f) return null;
  return {
    id: f.id,
    organizationId: f.organizationId,
    spaceId: f.spaceId,
    parentFolderId: f.parentFolderId,
    visibility: f.visibility,
    ownerId: f.ownerId,
    memberRole: grants.folder.get(f.id) ?? null,
    ancestorMemberRole: nearestAncestorRole(rows, grants, f.parentFolderId),
    name: f.name,
  };
}

function legacyBoard(rows: NodeRows, grants: ViewerGrants, listId: string | null | undefined): LegacyBoard | null {
  if (!listId) return null;
  const l = rows.lists.get(listId);
  if (!l) return null;
  return {
    id: l.id,
    organizationId: l.organizationId,
    spaceId: l.spaceId,
    folderId: l.folderId,
    visibility: l.visibility,
    ownerId: l.ownerId,
    memberRole: grants.list.get(l.id) ?? null,
    name: l.name,
  };
}

/** The struct a List question reads: the List, its direct Folder (with the ancestor role) and its Space. */
function listInputs(rows: NodeRows, grants: ViewerGrants, listId: string): LegacyInputs | null {
  const board = legacyBoard(rows, grants, listId);
  if (!board) return null;
  const inputs = baseInputs(rows, grants);
  inputs.board = board;
  const folder = legacyFolder(rows, grants, board.folderId);
  if (folder) inputs.folder = folder;
  const space = legacySpace(rows, grants, board.spaceId);
  if (space) inputs.space = space;
  return inputs;
}

/**
 * getBoardForReaderOrFolderGrantee's union (board.ts:700-716): a FolderMember
 * row on the List's Folder or on any ancestor of it, because
 * accessibleFolderIds cascades a grant to every descendant.
 */
function folderGranteeReaches(rows: NodeRows, grants: ViewerGrants, folderId: string | null): boolean {
  let cursor = folderId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (grants.folder.has(cursor)) return true;
    const f = rows.folders.get(cursor);
    if (!f) return false;
    cursor = f.parentFolderId;
  }
  return false;
}

// ── only today's rows ────────────────────────────────────────────────

/** Was a row written at `at` (epoch ms) before the workspace's cutoff? Unknown either way reads as yes. */
export function writtenBeforeCutoff(rows: NodeRows, at: number | null | undefined): boolean {
  if (rows.legacyBefore === null || at === null || at === undefined || !Number.isFinite(at)) return true;
  return at < rows.legacyBefore;
}

/**
 * The viewer's rows as today's code would have seen them: every Space,
 * Folder and List row written at or after the cutoff removed. The same object
 * when nothing is dropped.
 */
export function legacyGrantsOf(rows: NodeRows, grants: ViewerGrants): ViewerGrants {
  const since = grants.since;
  if (rows.legacyBefore === null || !since || since.size === 0) return grants;
  const keep = (kind: "space" | "folder" | "list", m: ViewerGrants["space"]) => {
    let out: ViewerGrants["space"] | null = null;
    for (const id of m.keys()) {
      if (writtenBeforeCutoff(rows, since.get(`${kind}:${id}`))) continue;
      out ??= new Map(m);
      out.delete(id);
    }
    return out ?? m;
  };
  const space = keep("space", grants.space);
  const folder = keep("folder", grants.folder);
  const list = keep("list", grants.list);
  if (space === grants.space && folder === grants.folder && list === grants.list) return grants;
  return { ...grants, space, folder, list };
}

// ── the floor ────────────────────────────────────────────────────────

function folderFloor(rows: NodeRows, grants: ViewerGrants, folderId: string): FloorRole {
  const folder = legacyFolder(rows, grants, folderId);
  if (!folder) return "none";
  const inputs = baseInputs(rows, grants);
  inputs.folder = folder;
  const space = legacySpace(rows, grants, folder.spaceId);
  if (space) inputs.space = space;
  if (!legacyAllows(inputs, "folderReadable")) return "none";
  return legacyAllows(inputs, "canEditSpace") ? "FULL" : "VIEW";
}

function listFloor(rows: NodeRows, grants: ViewerGrants, listId: string): FloorRole {
  const inputs = listInputs(rows, grants, listId);
  if (!inputs || !inputs.board) return "none";
  const reads =
    legacyAllows(inputs, "getBoardForReader") || folderGranteeReaches(rows, grants, inputs.board.folderId);
  if (!reads) return "none";
  if (legacyAllows(inputs, "canEditBoard")) return "FULL";
  if (legacyAllows(inputs, "canContributeBoard")) return "EDIT";
  return "VIEW";
}

function docFloor(rows: NodeRows, grants: ViewerGrants, docId: string): FloorRole {
  const doc = rows.docs.get(docId);
  if (!doc) return "none";
  const anchored = !!doc.entityType && !!doc.entityId;
  // A sub-page made after the cutoff gets no floor of its own: it follows its
  // parent (A6). One made before keeps today's answer below.
  if (!anchored && doc.parentId && !writtenBeforeCutoff(rows, doc.createdAt ? new Date(doc.createdAt).getTime() : null)) return "none";

  const inputs = baseInputs(rows, grants);
  inputs.doc = {
    id: doc.id,
    organizationId: doc.organizationId,
    createdById: doc.createdById,
    anchor: { entityType: doc.entityType, entityId: doc.entityId },
  };
  if (anchored) {
    const anchorId = doc.entityId as string;
    switch (doc.entityType) {
      case "SPACE": {
        const space = legacySpace(rows, grants, anchorId);
        if (space) inputs.space = space;
        break;
      }
      case "FOLDER": {
        const folder = legacyFolder(rows, grants, anchorId);
        if (folder) {
          inputs.folder = folder;
          const space = legacySpace(rows, grants, folder.spaceId);
          if (space) inputs.space = space;
        }
        break;
      }
      case "BOARD": {
        const li = listInputs(rows, grants, anchorId);
        if (li) Object.assign(inputs, { board: li.board, folder: li.folder, space: li.space });
        break;
      }
      case "BOARD_ITEM": {
        const item = rows.items.get(anchorId);
        if (item) {
          inputs.item = { id: item.id, organizationId: item.organizationId, boardId: item.boardId, ownerId: null, assigneeIds: [] };
          const li = listInputs(rows, grants, item.boardId);
          if (li) Object.assign(inputs, { board: li.board, folder: li.folder, space: li.space });
        }
        break;
      }
      default:
        break;
    }
  }
  if (!legacyAllows(inputs, "docAccessible")) return "none";

  const level = inputs.accessLevel;
  const role = legacyResolveDocRole(legacyEntryFor(rows.docSharing.get(doc.id), grants.viewer.userId), {
    userId: grants.viewer.userId,
    accessLevel: level,
    createdById: doc.createdById,
  });
  if (!role) return "none";
  if (legacyIsDocFull({ userId: grants.viewer.userId, accessLevel: level }, doc)) return "FULL";
  // Today's "every reader edits an unrestricted doc" is kept for the ROWS
  // that reach the doc (A8). The org-wide rule is no row: a reach it alone
  // gives (the doc out of reach once the org-wide Space or List is read
  // closed) floors at the Can view the rule gives everyone (R2, R4). Round
  // six, break 3: a Can view row this release wrote, which the floor drops,
  // read back as Can edit on every doc of an org-wide Space.
  if (role === "edit" && !legacyAllows(withOrgWideClosed(inputs), "docAccessible")) return "VIEW";
  return role === "edit" ? "EDIT" : "COMMENT";
}

/** The same inputs with every org-wide visibility closed: what today's rows alone reach. */
function withOrgWideClosed(inputs: LegacyInputs): LegacyInputs {
  const closed = (v: LegacySpace["visibility"]): LegacySpace["visibility"] => (v === "ORG" ? "WORKSPACE" : v);
  return {
    ...inputs,
    ...(inputs.space ? { space: { ...inputs.space, visibility: closed(inputs.space.visibility) } } : {}),
    ...(inputs.board ? { board: { ...inputs.board, visibility: closed(inputs.board.visibility) } } : {}),
  };
}

function canvasFloor(rows: NodeRows, grants: ViewerGrants, canvasId: string): FloorRole {
  const canvas = rows.canvases.get(canvasId);
  if (!canvas) return "none";
  const inputs = baseInputs(rows, grants);
  // whiteboard-gate.ts whiteboardSpaceVisible: no Space is org-wide.
  if (canvas.spaceId) {
    const space = legacySpace(rows, grants, canvas.spaceId);
    if (space) inputs.space = space;
    if (!legacyAllows(inputs, "getSpaceForReader")) return "none";
  }
  // api/whiteboards/[id] GET: owner or org admin Full, contributor or no Space Can edit, else Can view.
  if (grants.viewer.orgAdmin || canvas.ownerId === grants.viewer.userId) return "FULL";
  if (!canvas.spaceId) return "EDIT";
  return legacyAllows(inputs, "canContributeSpace") ? "EDIT" : "VIEW";
}

/**
 * Today's canEditSpace from today's rows (space.ts): the gate that let a Space
 * OWNER or ADMIN create and move Lists and Folders into any Folder of their
 * Space, a Private one that does not name them included. The strict rules
 * never give that (a Private Folder cuts the Space role), so the write gates
 * that replaced canEditSpace ask this under the legacy rule (A8). It never
 * makes the Folder readable: it is a write gate answer, not a floor.
 */
export function legacySpaceManages(rows: NodeRows, allGrants: ViewerGrants, spaceId: string | null | undefined): boolean {
  if (allGrants.viewer.denied || !spaceId) return false;
  const grants = legacyGrantsOf(rows, allGrants);
  const space = legacySpace(rows, grants, spaceId);
  if (!space) return false;
  const inputs = baseInputs(rows, grants);
  inputs.space = space;
  return legacyAllows(inputs, "canEditSpace");
}

/** Today's answer for one node from the same rows (today's rows only), or "none". */
export function floorFor(rows: NodeRows, allGrants: ViewerGrants, ref: NodeRef): FloorRole {
  if (allGrants.viewer.denied) return "none";
  const grants = legacyGrantsOf(rows, allGrants);
  switch (ref.kind) {
    case "folder":
      return folderFloor(rows, grants, ref.id);
    case "list":
      return listFloor(rows, grants, ref.id);
    case "doc":
      return docFloor(rows, grants, ref.id);
    case "canvas":
      return canvasFloor(rows, grants, ref.id);
    case "space":
    case "table":
    case "form":
      return "none";
  }
}
