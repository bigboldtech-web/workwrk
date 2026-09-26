// The one access model's rules, as a pure function of one loaded world.
//
// decide(rows, grants, ref) answers "what role does this person hold on this
// node" for every node kind the Manage access dialog covers: Space, Folder
// (any depth), List, Doc (with its sub-pages), Table, Canvas and Form. It is
// total and pure: the loaders in node-world.ts fill NodeRows (the shared
// facts of the nodes on a chain or in a Space) and ViewerGrants (one
// person's own rows), and node-access.ts is the only server module that
// calls it. Tasks follow their List through item-gate.ts's decideItem.
//
// THE RULES (decision A5: the effective role is the highest of the org admin
// override, the Space role, any ancestor grant and the node's own grant; a
// PRIVATE node cuts inheritance at itself; org admins see everything):
//
//   R0  a denied viewer (deleted or INACTIVE) holds nothing.
//   R1  an org admin holds Full access on every node except a private note.
//   R2  Space: its own SpaceMember row, or Can view for everyone when the
//       Space is org-wide. Space.ownerId gives nothing (as today).
//   R3  Folder: its own FolderMember row; its owner (only with reach through
//       the parent unless the Folder is PRIVATE); the parent's role unless
//       the Folder is PRIVATE; and the lift, a Space manager named on a
//       PRIVATE Folder manages it.
//   R4  List: the same shape, plus the Space OWNER's pierce into a PRIVATE
//       List (never through a PRIVATE Folder that does not name them) and
//       Can view for everyone on an org-wide List. A List grant or ownership
//       opens the List under any Folder: grants never cut.
//   R6  Doc: a note (NOTEPAD) is its owner's alone. Anchored docs follow the
//       anchor: a reach from the org-wide rule or from a row written before
//       the cutoff edits an unrestricted doc (today's rule), a row written
//       after it gives its own role (R6b, anchoredDocRole); a
//       sub-page follows its parent page exactly (A6); a root doc is the
//       whole org's. A listing pierces reach; restricted keeps only the
//       listed people; a listing made before this release is a cap.
//   R7  Table, R8 Canvas, R9 Form: their container (or the org), their
//       creator or owner, and an AccessGrant row that pierces.
//   R10 a Space or Folder with no role is a PATH container when something
//       below it has a strict role: named on the way, never opened.
//   R11 under the "legacy" Private rule the effective role is the higher of
//       these rules and today's answer (legacy-floor.ts).
//
// Roles never climb: nothing on this page reads a grant upward, so a Folder
// grant (Full included) gives nothing on its Space or on sibling nodes.
//
// THE PLACEMENT RULE (P1 to P7, its own section below) is the one answer to
// "may this person create a node here, or move one there": Can edit creates
// inside a container, a move needs Full access on the node and on what it
// leaves and Can edit where it goes, and a node's Space always comes from
// its parent. Every create, move, reorder and restore route asks it.
//
// Pure: imports ./types, ./access-panel, ./legacy-floor, ./legacy-levels and
// ./org-role. No prisma, no clock.

import type { ObjectRole } from "./types";
import { PANEL_ROLE_RANK, type AccessGrantSource, type AccessNodeKind, type PanelRole } from "./access-panel";
import { floorFor, legacyGrantsOf, legacySpaceManages } from "./legacy-floor";
import { legacyIsAdminLevel } from "./legacy-levels";
import { orgRoleOf } from "./org-role";

// ── the vocabulary ───────────────────────────────────────────────────

export type NodeKind = AccessNodeKind;
export interface NodeRef { kind: NodeKind; id: string }
export type NodeRole = PanelRole | "none";
export type MemberRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
export type NodeVisibility = "PRIVATE" | "WORKSPACE" | "ORG";
export type PrivateRule = "legacy" | "strict";
/** The role vocabulary the tree rows and the "..." menus read. */
export type TreeRole = "full" | "edit" | "comment" | "view";

export function refKey(ref: NodeRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function sameRef(a: NodeRef, b: NodeRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Who is asking. `denied` covers a deleted or INACTIVE account (R0). */
export interface NodeViewer {
  userId: string;
  orgAdmin: boolean;
  orgGuest: boolean;
  isAgent: boolean;
  denied: boolean;
}

export interface NodeCtx extends NodeViewer {
  organizationId: string;
}

/**
 * The context a route builds from the legacy level it already holds. The
 * missing level defaults to EMPLOYEE FIRST, the default every gate applies
 * today (table-gate.ts, item-gate.ts, every container route), so a session
 * with no level is a Member and never a Guest; only an unknown level string
 * is a Guest (orgRoleOf's rule).
 */
export function nodeCtxFromLevel(userId: string, organizationId: string, level: string | null | undefined): NodeCtx {
  const lvl = level ?? "EMPLOYEE";
  return {
    userId,
    organizationId,
    orgAdmin: legacyIsAdminLevel(lvl),
    orgGuest: orgRoleOf({ accessLevel: lvl }) === "GUEST",
    isAgent: lvl === "AGENT",
    denied: false,
  };
}

// ── the facts ────────────────────────────────────────────────────────

export interface SpaceFact {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  icon: string | null;
  color: string | null;
  visibility: NodeVisibility;
  ownerId: string | null;
  description?: string | null;
  parentSpaceId?: string | null;
  displayOrder?: number;
}

export interface FolderFact {
  id: string;
  organizationId: string;
  spaceId: string;
  parentFolderId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  visibility: NodeVisibility;
  ownerId: string | null;
  position: number;
  /**
   * In Trash. Access reads straight through it (a role flows down the chain
   * as it does for a live Folder); the Space tree renders neither it nor
   * anything inside it.
   */
  archived?: boolean;
}

export interface ListFact {
  id: string;
  organizationId: string;
  spaceId: string | null;
  folderId: string | null;
  name: string;
  slug: string;
  icon: string | null;
  color: string | null;
  visibility: NodeVisibility;
  ownerId: string | null;
  settings?: unknown;
}

export interface DocFact {
  id: string;
  organizationId: string;
  title: string;
  entityType: string | null;
  entityId: string | null;
  parentId: string | null;
  createdById: string | null;
  /**
   * When the page was made. The legacy floor reads it for sub-pages only: a
   * page made before the workspace's cutoff keeps today's reach under the
   * legacy rule, one made after follows its parent (A6). Absent reads as made
   * before the cutoff.
   */
  createdAt?: Date | null;
  /**
   * The page is locked (Doc.lockedById set). The lock is no access rule and
   * never reaches the pages below (applyDocLock), but the page's own list of
   * sub-pages is part of the page: as a container it takes a new or a
   * moved-in sub-page only from a Full holder (createAllowed). Absent reads
   * as unlocked.
   */
  locked?: boolean;
}

export interface ItemFact { id: string; organizationId: string; boardId: string }

export interface TableFact {
  id: string;
  organizationId: string;
  spaceId: string | null;
  createdById: string | null;
  name: string;
  description?: string | null;
}

export interface CanvasFact {
  id: string;
  organizationId: string;
  spaceId: string | null;
  folderId: string | null;
  ownerId: string | null;
  name: string;
}

export interface FormFact {
  id: string;
  organizationId: string;
  createdById: string | null;
  name: string;
  targetBoardId: string | null;
  targetTableId: string | null;
}

/**
 * Organization.settings.docSharing[docId]. `members` is the legacy map (and,
 * for listings this release writes, the rollback projection); `roles` holds
 * the role this release wrote. A person in members alone is a legacy listing.
 */
export interface DocSharingFact {
  restricted?: boolean;
  members?: Record<string, "edit" | "view">;
  roles?: Record<string, ObjectRole>;
  publicSecret?: string;
  publicCreatedAt?: string;
}

/** The shared facts of one loaded world. Every map is org-scoped by its loader. */
export interface NodeRows {
  organizationId: string;
  privateRule: PrivateRule;
  spaces: Map<string, SpaceFact>;
  folders: Map<string, FolderFact>;
  lists: Map<string, ListFact>;
  docs: Map<string, DocFact>;
  items: Map<string, ItemFact>;
  tables: Map<string, TableFact>;
  canvases: Map<string, CanvasFact>;
  forms: Map<string, FormFact>;
  docSharing: Map<string, DocSharingFact>;
  orgAdmins: Set<string>;
  /**
   * The workspace's legacy cutoff (Organization.settings.accessLegacyCutoff),
   * as epoch ms: rows written at or after it are this release's and get no
   * legacy floor (decision A8 keeps EXISTING rows' reach, A2 holds for new
   * ones). Null when unknown, which reads every row as existing (today's
   * answer, never a loss).
   */
  legacyBefore: number | null;
}

/** One person's own rows in the world. `object` keys are "table:id", "canvas:id", "form:id". */
export interface ViewerGrants {
  viewer: NodeViewer;
  space: Map<string, MemberRole>;
  folder: Map<string, MemberRole>;
  list: Map<string, MemberRole>;
  object: Map<string, MemberRole>;
  /**
   * When each Space, Folder and List row was written, as epoch ms keyed by
   * refKey ("space:id", "folder:id", "list:id"). The legacy floor drops the
   * rows written at or after rows.legacyBefore. Absent (or a key missing)
   * reads as written before the cutoff.
   */
  since?: Map<string, number>;
}

export function emptyRows(organizationId: string, privateRule: PrivateRule = "legacy"): NodeRows {
  return {
    organizationId,
    privateRule,
    spaces: new Map(),
    folders: new Map(),
    lists: new Map(),
    docs: new Map(),
    items: new Map(),
    tables: new Map(),
    canvases: new Map(),
    forms: new Map(),
    docSharing: new Map(),
    orgAdmins: new Set(),
    legacyBefore: null,
  };
}

export function emptyGrants(viewer: NodeViewer): ViewerGrants {
  return { viewer, space: new Map(), folder: new Map(), list: new Map(), object: new Map() };
}

export type ObjectGrantKind = "table" | "canvas" | "form";

export function objectGrantKey(kind: ObjectGrantKind, id: string): string {
  return `${kind}:${id}`;
}

// ── mapping helpers ──────────────────────────────────────────────────

export function rankOf(role: NodeRole): number {
  return PANEL_ROLE_RANK[role];
}

/** Every FULL gate accepts OWNER: the rank does it. */
export function roleAtLeast(role: NodeRole, floor: PanelRole): boolean {
  return rankOf(role) >= rankOf(floor);
}

export function higherRole(a: NodeRole, b: NodeRole): NodeRole {
  return rankOf(a) >= rankOf(b) ? a : b;
}

/** m() for a SpaceMember row: the Owner rung survives on a Space. */
export function spaceMemberToRole(role: MemberRole): PanelRole {
  if (role === "OWNER") return "OWNER";
  if (role === "ADMIN") return "FULL";
  if (role === "MEMBER") return "EDIT";
  return "VIEW";
}

/** m() for FolderMember, BoardMember and AccessGrant rows. */
export function memberToRole(role: MemberRole): PanelRole {
  if (role === "OWNER" || role === "ADMIN") return "FULL";
  if (role === "MEMBER") return "EDIT";
  return "VIEW";
}

/** OWNER or FULL full, EDIT edit, COMMENT comment, VIEW view, none null. */
export function toContainerRole(role: NodeRole): TreeRole | null {
  switch (role) {
    case "OWNER":
    case "FULL":
      return "full";
    case "EDIT":
      return "edit";
    case "COMMENT":
      return "comment";
    case "VIEW":
      return "view";
    default:
      return null;
  }
}

/** src/lib/access.ts's vocabulary: FULL or OWNER admin, EDIT edit, COMMENT or VIEW read. */
export function toLegacyPermission(role: NodeRole): "none" | "read" | "edit" | "admin" {
  if (role === "OWNER" || role === "FULL") return "admin";
  if (role === "EDIT") return "edit";
  if (role === "COMMENT" || role === "VIEW") return "read";
  return "none";
}

/** requireDocRole's vocabulary: FULL or EDIT "edit", COMMENT or VIEW "view", none null. */
export function toDocRole(role: NodeRole): "edit" | "view" | null {
  if (role === "OWNER" || role === "FULL" || role === "EDIT") return "edit";
  if (role === "COMMENT" || role === "VIEW") return "view";
  return null;
}

/**
 * R6h, the page lock: while a doc is locked, everyone below Full access reads
 * it as Can comment (a Can view holder stays at Can view: a lock never
 * widens). Applied by docRoleFor, never inherited by sub-pages: a lock
 * freezes one page's content and is not an access rule.
 */
export function applyDocLock(role: NodeRole, locked: boolean): NodeRole {
  if (!locked || roleAtLeast(role, "FULL")) return role;
  if (role === "EDIT" || role === "COMMENT") return "COMMENT";
  return role;
}

const OBJECT_ROLES: ReadonlySet<string> = new Set(["FULL", "EDIT", "COMMENT", "VIEW"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** One docSharing entry, read defensively: a malformed field reads as absent. */
export function sanitizeDocSharingEntry(raw: unknown): DocSharingFact | undefined {
  if (!isObj(raw)) return undefined;
  const out: DocSharingFact = {};
  if (raw.restricted === true) out.restricted = true;
  if (isObj(raw.members)) {
    const members: Record<string, "edit" | "view"> = {};
    for (const [k, v] of Object.entries(raw.members)) if (v === "edit" || v === "view") members[k] = v;
    out.members = members;
  }
  if (isObj(raw.roles)) {
    const roles: Record<string, ObjectRole> = {};
    for (const [k, v] of Object.entries(raw.roles)) if (typeof v === "string" && OBJECT_ROLES.has(v)) roles[k] = v as ObjectRole;
    out.roles = roles;
  }
  if (typeof raw.publicSecret === "string" && raw.publicSecret) out.publicSecret = raw.publicSecret;
  if (typeof raw.publicCreatedAt === "string") out.publicCreatedAt = raw.publicCreatedAt;
  return out;
}

/**
 * settings.docSharing[docId] with this module's own typeof guard (it never
 * imports doc-sharing.ts, which reads prisma).
 */
export function readDocSharingEntry(settings: unknown, docId: string): DocSharingFact | undefined {
  if (!isObj(settings)) return undefined;
  const map = settings.docSharing;
  if (!isObj(map)) return undefined;
  return sanitizeDocSharingEntry(map[docId]);
}

/** Organization.settings.accessModel.privateRule; absent or unknown is legacy. */
export function readPrivateRule(settings: unknown): PrivateRule {
  if (!isObj(settings)) return "legacy";
  const model = settings.accessModel;
  return isObj(model) && model.privateRule === "strict" ? "strict" : "legacy";
}

// ── where a role comes from ──────────────────────────────────────────

export type NodeVia =
  | { type: "org_admin" }
  | { type: "own"; node: NodeRef; source: AccessGrantSource }
  | { type: "owner"; node: NodeRef }
  | { type: "lift"; node: NodeRef }
  | { type: "pierce"; node: NodeRef }
  | { type: "inherited"; node: NodeRef; source: AccessGrantSource | null }
  | { type: "everyone"; node: NodeRef | null }
  | { type: "floor"; node: NodeRef }
  | { type: "none" };

export interface NodeDecision {
  /** The effective role (R11): the strict role, or today's when that is higher under the legacy rule. */
  role: NodeRole;
  strictRole: NodeRole;
  via: NodeVia;
  /** R10: a Space or Folder with no role that sits on the way to a node the viewer holds a strict role on. */
  path: boolean;
}

interface Res { role: NodeRole; via: NodeVia }

const NONE: Res = { role: "none", via: { type: "none" } };

// The tie order (R12): own, then owner, then lift or pierce, then the nearest
// inherited ancestor, then everyone, then the floor.
const P_OWN = 0;
const P_OWNER = 1;
const P_LIFT = 2;
const P_INHERITED = 3;
const P_EVERYONE = 4;

interface Candidate { role: NodeRole; via: NodeVia; prio: number }

function pick(cands: Candidate[]): Res {
  let best: Candidate | null = null;
  for (const c of cands) {
    if (c.role === "none") continue;
    if (!best || rankOf(c.role) > rankOf(best.role) || (rankOf(c.role) === rankOf(best.role) && c.prio < best.prio)) {
      best = c;
    }
  }
  return best ? { role: best.role, via: best.via } : NONE;
}

/** A child inherits the parent's role; the Space Owner rung is Full access below the Space. */
function inheritRole(role: NodeRole): NodeRole {
  return role === "OWNER" ? "FULL" : role;
}

/** The via a child reads when its role comes from its parent: the node holding the grant. */
function inheritVia(via: NodeVia): NodeVia {
  switch (via.type) {
    case "own":
      return { type: "inherited", node: via.node, source: via.source };
    case "owner":
      return { type: "inherited", node: via.node, source: "Owner" };
    case "lift":
      return { type: "inherited", node: via.node, source: "FolderMember" };
    case "pierce":
      return { type: "inherited", node: via.node, source: "SpaceMember" };
    default:
      return via;
  }
}

function up(parent: Res): Candidate {
  return { role: inheritRole(parent.role), via: inheritVia(parent.via), prio: parent.via.type === "everyone" ? P_EVERYONE : P_INHERITED };
}

// ── chains ───────────────────────────────────────────────────────────

/**
 * A Folder's parent Folder: the row its parentFolderId names when it is in
 * the same org and Space and the chain above it does not loop back (corrupt
 * data). Anything else reads as "the Space is the parent".
 */
export function folderParentOf(rows: NodeRows, folder: FolderFact): FolderFact | null {
  if (!folder.parentFolderId) return null;
  const parent = rows.folders.get(folder.parentFolderId);
  if (!parent || parent.organizationId !== folder.organizationId || parent.spaceId !== folder.spaceId) return null;
  const seen = new Set<string>([folder.id]);
  let cursor: FolderFact | undefined = parent;
  for (let hops = 0; cursor && hops < 64; hops += 1) {
    if (seen.has(cursor.id)) return null;
    seen.add(cursor.id);
    if (!cursor.parentFolderId) break;
    const next = rows.folders.get(cursor.parentFolderId);
    if (!next || next.organizationId !== folder.organizationId || next.spaceId !== folder.spaceId) break;
    cursor = next;
  }
  return parent;
}

/** Nearest first: the Folder's own ancestors (not the Folder itself). */
export function folderAncestors(rows: NodeRows, folder: FolderFact): FolderFact[] {
  const out: FolderFact[] = [];
  let cursor = folderParentOf(rows, folder);
  while (cursor && out.length < 64) {
    out.push(cursor);
    cursor = folderParentOf(rows, cursor);
  }
  return out;
}

/** A List's Folder when that Folder is in the List's own Space and org. */
export function listFolderOf(rows: NodeRows, list: ListFact): FolderFact | null {
  if (!list.folderId) return null;
  const f = rows.folders.get(list.folderId);
  if (!f || f.organizationId !== list.organizationId || f.spaceId !== list.spaceId) return null;
  return f;
}

/** A canvas's Folder when that Folder is in the canvas's own Space (a stale folderId reads as the Space). */
export function canvasFolderOf(rows: NodeRows, canvas: CanvasFact): FolderFact | null {
  if (!canvas.folderId || !canvas.spaceId) return null;
  const f = rows.folders.get(canvas.folderId);
  if (!f || f.organizationId !== canvas.organizationId || f.spaceId !== canvas.spaceId) return null;
  return f;
}

/** The containers above a Folder chain position, nearest first, ending at the Space. */
function containersFrom(rows: NodeRows, folder: FolderFact | null, spaceId: string | null): NodeRef[] {
  const out: NodeRef[] = [];
  if (folder) {
    out.push({ kind: "folder", id: folder.id });
    for (const a of folderAncestors(rows, folder)) out.push({ kind: "folder", id: a.id });
  }
  if (spaceId) out.push({ kind: "space", id: spaceId });
  return out;
}

const DOC_HOPS = 8;

/** The note owner when the doc or any ancestor page is anchored NOTEPAD (R6a), else undefined. */
export function notepadOwnerOf(rows: NodeRows, doc: DocFact): string | undefined {
  const seen = new Set<string>();
  let cursor: DocFact | undefined = doc;
  for (let hops = 0; cursor && hops <= DOC_HOPS; hops += 1) {
    if (seen.has(cursor.id)) return undefined;
    seen.add(cursor.id);
    if (cursor.entityType === "NOTEPAD" && cursor.entityId) return cursor.entityId;
    if (!cursor.parentId) return undefined;
    const next = rows.docs.get(cursor.parentId);
    if (!next || next.organizationId !== doc.organizationId) return undefined;
    cursor = next;
  }
  return undefined;
}

export type DocShape = "anchored" | "subpage" | "root";

export function docShape(doc: DocFact): DocShape {
  if (doc.entityType && doc.entityId) return "anchored";
  return doc.parentId ? "subpage" : "root";
}

/**
 * The first anchored page on a doc's parent chain (the doc itself when it is
 * anchored), or null for a root chain, a missing or foreign parent, a loop,
 * or a chain deeper than eight pages.
 */
export function topAnchorDoc(rows: NodeRows, doc: DocFact): DocFact | null {
  const seen = new Set<string>();
  let cursor: DocFact | undefined = doc;
  for (let hops = 0; cursor && hops <= DOC_HOPS; hops += 1) {
    if (seen.has(cursor.id)) return null;
    seen.add(cursor.id);
    if (docShape(cursor) === "anchored") return cursor;
    if (!cursor.parentId) return null;
    const next = rows.docs.get(cursor.parentId);
    if (!next || next.organizationId !== doc.organizationId) return null;
    cursor = next;
  }
  return null;
}

/** Can a sub-page's parent be read as its parent at all (exists, same org, no loop, at most 8 pages up)? */
function subpageParent(rows: NodeRows, doc: DocFact): DocFact | null {
  if (!doc.parentId) return null;
  const parent = rows.docs.get(doc.parentId);
  if (!parent || parent.organizationId !== doc.organizationId) return null;
  // Walk to the top: a loop or a chain deeper than the limit reads as no parent.
  const seen = new Set<string>([doc.id]);
  let cursor: DocFact | undefined = parent;
  for (let hops = 0; ; hops += 1) {
    if (!cursor) return parent;
    if (seen.has(cursor.id)) return null;
    if (hops >= DOC_HOPS) return null;
    seen.add(cursor.id);
    if (docShape(cursor) !== "subpage") return parent;
    cursor = rows.docs.get(cursor.parentId as string);
    if (cursor && cursor.organizationId !== doc.organizationId) return parent;
  }
}

/**
 * Where a node is placed, as the containers above it, nearest first: the
 * chain that becomes path containers when the node has a strict role (R10)
 * and the one node-tree.ts hangs it under.
 */
export function placementContainers(rows: NodeRows, ref: NodeRef): NodeRef[] {
  switch (ref.kind) {
    case "space":
      return [];
    case "folder": {
      const f = rows.folders.get(ref.id);
      if (!f) return [];
      return containersFrom(rows, folderParentOf(rows, f), f.spaceId);
    }
    case "list": {
      const l = rows.lists.get(ref.id);
      if (!l) return [];
      return containersFrom(rows, listFolderOf(rows, l), l.spaceId);
    }
    case "canvas": {
      const c = rows.canvases.get(ref.id);
      if (!c) return [];
      return containersFrom(rows, canvasFolderOf(rows, c), c.spaceId);
    }
    case "table": {
      const t = rows.tables.get(ref.id);
      return t?.spaceId ? [{ kind: "space", id: t.spaceId }] : [];
    }
    case "form":
      return [];
    case "doc": {
      const d = rows.docs.get(ref.id);
      if (!d) return [];
      const top = topAnchorDoc(rows, d);
      if (!top) return [];
      return anchorContainers(rows, top);
    }
  }
}

/** Does the chain above a node pass through a Folder in Trash? Such a node is on no path (the tree hides it). */
export function inTrashedFolder(rows: NodeRows, chain: readonly NodeRef[]): boolean {
  return chain.some((c) => c.kind === "folder" && rows.folders.get(c.id)?.archived === true);
}

/** The containers an anchored doc hangs under: its Space or Folder itself, or its List's (or task's List's) containers. */
export function anchorContainers(rows: NodeRows, anchored: DocFact): NodeRef[] {
  const id = anchored.entityId as string;
  switch (anchored.entityType) {
    case "SPACE":
      return rows.spaces.has(id) ? [{ kind: "space", id }] : [];
    case "FOLDER": {
      const f = rows.folders.get(id);
      return f ? containersFrom(rows, f, f.spaceId) : [];
    }
    case "BOARD": {
      const l = rows.lists.get(id);
      return l ? containersFrom(rows, listFolderOf(rows, l), l.spaceId) : [];
    }
    case "BOARD_ITEM": {
      const item = rows.items.get(id);
      const l = item ? rows.lists.get(item.boardId) : undefined;
      return l ? containersFrom(rows, listFolderOf(rows, l), l.spaceId) : [];
    }
    default:
      return [];
  }
}

// ── the evaluator ────────────────────────────────────────────────────

type Mode = "strict" | "effective";

/**
 * One viewer over one world, memoised. decide() and decideAll() build one;
 * node-tree.ts and the panel builder reuse one per person so a Space of a
 * thousand nodes is one pass, never a query or a walk per row.
 */
export class NodeEvaluator {
  private readonly memo: Record<Mode, Map<string, Res>> = { strict: new Map(), effective: new Map() };
  private readonly busy: Record<Mode, Set<string>> = { strict: new Set(), effective: new Set() };
  private pathSet: Set<string> | null = null;

  constructor(readonly rows: NodeRows, readonly grants: ViewerGrants) {}

  private get u(): string {
    return this.grants.viewer.userId;
  }

  private sameOrg(orgId: string): boolean {
    return orgId === this.rows.organizationId;
  }

  strict(ref: NodeRef): Res {
    return this.eval(ref, "strict");
  }

  effective(ref: NodeRef): Res {
    return this.eval(ref, "effective");
  }

  private eval(ref: NodeRef, mode: Mode): Res {
    const key = refKey(ref);
    const hit = this.memo[mode].get(key);
    if (hit) return hit;
    // A loop the chain walks did not catch (never on sane data) reads as none.
    if (this.busy[mode].has(key)) return NONE;
    this.busy[mode].add(key);
    let res: Res;
    try {
      res = this.compute(ref, mode);
    } finally {
      this.busy[mode].delete(key);
    }
    this.memo[mode].set(key, res);
    return res;
  }

  private compute(ref: NodeRef, mode: Mode): Res {
    const v = this.grants.viewer;
    if (v.denied) return NONE; // R0
    if (mode === "effective") return this.computeEffective(ref);
    if (ref.kind === "doc") return this.doc(ref.id, "strict");
    if (v.orgAdmin) return this.orgAdminRes(ref); // R1
    switch (ref.kind) {
      case "space":
        return this.space(ref.id);
      case "folder":
        return this.folder(ref.id);
      case "list":
        return this.list(ref.id);
      case "table":
        return this.table(ref.id);
      case "canvas":
        return this.canvas(ref.id);
      case "form":
        return this.form(ref.id);
    }
  }

  /** R1 for a node that exists in the org; a missing node is none even for an admin. */
  private orgAdminRes(ref: NodeRef): Res {
    const row = this.rowOf(ref);
    if (!row || !this.sameOrg(row.organizationId)) return NONE;
    return { role: "FULL", via: { type: "org_admin" } };
  }

  private rowOf(ref: NodeRef): { organizationId: string } | undefined {
    switch (ref.kind) {
      case "space":
        return this.rows.spaces.get(ref.id);
      case "folder":
        return this.rows.folders.get(ref.id);
      case "list":
        return this.rows.lists.get(ref.id);
      case "doc":
        return this.rows.docs.get(ref.id);
      case "table":
        return this.rows.tables.get(ref.id);
      case "canvas":
        return this.rows.canvases.get(ref.id);
      case "form":
        return this.rows.forms.get(ref.id);
    }
  }

  /**
   * R11. A sub-page reads through its parent's EFFECTIVE role (a parent read
   * by the floor passes that reach down, A6), and also keeps its own floor:
   * a page made before the workspace's cutoff keeps today's org-wide reach
   * (A8, delta N5 is a strict-rule narrowing); one made after has none.
   */
  private computeEffective(ref: NodeRef): Res {
    const strict = this.strict(ref);
    if (this.rows.privateRule === "strict") return strict;
    let best = strict;
    if (ref.kind === "doc") {
      const d = this.rows.docs.get(ref.id);
      if (d && docShape(d) === "subpage") {
        // A page under a note is its owner's alone (R6a): no floor ever opens it.
        if (notepadOwnerOf(this.rows, d) !== undefined) return strict;
        if (!this.grants.viewer.orgAdmin) best = this.doc(ref.id, "effective");
      }
    }
    const floor = floorFor(this.rows, this.grants, ref);
    if (rankOf(floor) > rankOf(best.role)) return { role: floor, via: { type: "floor", node: ref } };
    return best;
  }

  /**
   * Today's answer alone (R11's floor), or "none" under the strict Private
   * rule. The write gates that kept a HEAD capability below the strict role
   * read it: unplacing a doc, taking a canvas out of its Space, moving a
   * canvas to the Trash (A8). Today's rows only, so a grant made by this
   * release never earns it.
   */
  floorRole(ref: NodeRef): NodeRole {
    if (this.grants.viewer.denied || this.rows.privateRule === "strict") return "none";
    return floorFor(this.rows, this.grants, ref);
  }

  /**
   * Today's canEditSpace under the legacy rule: a Space OWNER or ADMIN (by a
   * row from before the cutoff) creates and moves Lists and Folders into any
   * Folder of that Space, as they did before node-access. Never under strict.
   */
  legacyManagesSpace(spaceId: string | null | undefined): boolean {
    if (this.rows.privateRule === "strict") return false;
    return legacySpaceManages(this.rows, this.grants, spaceId);
  }

  // R2
  private space(id: string): Res {
    const s = this.rows.spaces.get(id);
    if (!s || !this.sameOrg(s.organizationId)) return NONE;
    const ref: NodeRef = { kind: "space", id };
    const own = this.grants.space.get(id);
    return pick([
      own ? { role: spaceMemberToRole(own), via: { type: "own", node: ref, source: "SpaceMember" }, prio: P_OWN } : null,
      s.visibility === "ORG" ? { role: "VIEW" as NodeRole, via: { type: "everyone", node: ref } as NodeVia, prio: P_EVERYONE } : null,
    ].filter((c): c is Candidate => c !== null));
  }

  // R3
  private folder(id: string): Res {
    const f = this.rows.folders.get(id);
    if (!f || !this.sameOrg(f.organizationId)) return NONE;
    const ref: NodeRef = { kind: "folder", id };
    const parent = folderParentOf(this.rows, f);
    const parentRes = parent ? this.strict({ kind: "folder", id: parent.id }) : this.strict({ kind: "space", id: f.spaceId });
    const isPrivate = f.visibility === "PRIVATE";
    const upC = isPrivate ? null : up(parentRes);
    const own = this.grants.folder.get(id);
    const cands: Candidate[] = [];
    if (own) cands.push({ role: memberToRole(own), via: { type: "own", node: ref, source: "FolderMember" }, prio: P_OWN });
    if (f.ownerId && f.ownerId === this.u && (isPrivate || (upC && upC.role !== "none"))) {
      cands.push({ role: "FULL", via: { type: "owner", node: ref }, prio: P_OWNER });
    }
    if (isPrivate && own) {
      const spaceRole = this.strict({ kind: "space", id: f.spaceId }).role;
      if (roleAtLeast(spaceRole, "FULL")) cands.push({ role: "FULL", via: { type: "lift", node: ref }, prio: P_LIFT });
    }
    if (upC) cands.push(upC);
    return pick(cands);
  }

  // R4
  private list(id: string): Res {
    const l = this.rows.lists.get(id);
    if (!l || !this.sameOrg(l.organizationId)) return NONE;
    const ref: NodeRef = { kind: "list", id };
    const folder = listFolderOf(this.rows, l);
    const parentRes = folder
      ? this.strict({ kind: "folder", id: folder.id })
      : l.spaceId
        ? this.strict({ kind: "space", id: l.spaceId })
        : NONE;
    const isPrivate = l.visibility === "PRIVATE";
    const upC = isPrivate ? null : up(parentRes);
    const own = this.grants.list.get(id);
    const cands: Candidate[] = [];
    if (own) cands.push({ role: memberToRole(own), via: { type: "own", node: ref, source: "BoardMember" }, prio: P_OWN });
    if (l.ownerId && l.ownerId === this.u && (isPrivate || (upC && upC.role !== "none"))) {
      cands.push({ role: "FULL", via: { type: "owner", node: ref }, prio: P_OWNER });
    }
    if (isPrivate && l.spaceId && this.grants.space.get(l.spaceId) === "OWNER" && parentRes.role !== "none") {
      cands.push({ role: "FULL", via: { type: "pierce", node: { kind: "space", id: l.spaceId } }, prio: P_LIFT });
    }
    if (upC) cands.push(upC);
    if (l.visibility === "ORG" && this.privateChainOpen(folder)) {
      cands.push({ role: "VIEW", via: { type: "everyone", node: ref }, prio: P_EVERYONE });
    }
    return pick(cands);
  }

  /** Does every PRIVATE Folder on this chain give the viewer a role (the org-wide List rule)? */
  private privateChainOpen(folder: FolderFact | null): boolean {
    if (!folder) return true;
    for (const f of [folder, ...folderAncestors(this.rows, folder)]) {
      if (f.visibility === "PRIVATE" && this.strict({ kind: "folder", id: f.id }).role === "none") return false;
    }
    return true;
  }

  // R6
  private doc(id: string, mode: Mode): Res {
    const d = this.rows.docs.get(id);
    if (!d || !this.sameOrg(d.organizationId)) return NONE;
    const ref: NodeRef = { kind: "doc", id };
    const note = notepadOwnerOf(this.rows, d);
    if (note !== undefined) return note === this.u ? { role: "FULL", via: { type: "owner", node: ref } } : NONE; // R6a
    if (this.grants.viewer.orgAdmin) return { role: "FULL", via: { type: "org_admin" } }; // R1

    const shape = docShape(d);
    const entry = this.rows.docSharing.get(id);
    const granted = entry?.roles?.[this.u];
    const legacyListed = !granted ? entry?.members?.[this.u] : undefined;
    const grant: Candidate | null = granted
      ? { role: granted, via: { type: "own", node: ref, source: "DocSharing" }, prio: P_OWN }
      : null;
    const cap: Candidate | null = legacyListed
      ? { role: legacyListed === "edit" ? "EDIT" : "COMMENT", via: { type: "own", node: ref, source: "DocSharingLegacy" }, prio: P_OWN }
      : null;

    let base: Candidate | null = null;
    let reaches = false;
    if (shape === "anchored") {
      const reach = this.anchorReach(d);
      reaches = reach.role !== "none";
      if (reaches) {
        const got = this.anchoredDocRole(d, reach);
        base = { role: got.role, via: inheritVia(got.via), prio: got.via.type === "everyone" ? P_EVERYONE : P_INHERITED };
      }
    } else if (shape === "subpage") {
      const parent = subpageParent(this.rows, d);
      const parentRes = parent ? this.eval({ kind: "doc", id: parent.id }, mode) : NONE;
      reaches = parentRes.role !== "none";
      if (reaches) {
        base = {
          role: inheritRole(parentRes.role),
          via: parentRes.via.type === "floor" ? parentRes.via : inheritVia(parentRes.via),
          prio: parentRes.via.type === "everyone" ? P_EVERYONE : P_INHERITED,
        };
      }
    } else {
      reaches = true;
      base = { role: "EDIT", via: { type: "everyone", node: null }, prio: P_EVERYONE };
    }
    const creator: Candidate | null =
      d.createdById && d.createdById === this.u && reaches
        ? { role: "FULL", via: { type: "owner", node: ref }, prio: P_OWNER }
        : null;

    const cands: Array<Candidate | null> = entry?.restricted
      ? [grant, cap, creator]
      : cap
        ? [cap, creator]
        : [base, grant, creator];
    return pick(cands.filter((c): c is Candidate => c !== null));
  }

  private legacyEvaluator: NodeEvaluator | null | undefined;

  /**
   * The same world over the viewer's rows from before the workspace's cutoff
   * only (legacyGrantsOf), or null when no row is new: then every reach is
   * today's.
   */
  private legacyEv(): NodeEvaluator | null {
    if (this.legacyEvaluator !== undefined) return this.legacyEvaluator;
    const old = legacyGrantsOf(this.rows, this.grants);
    this.legacyEvaluator = old === this.grants ? null : new NodeEvaluator(this.rows, old);
    return this.legacyEvaluator;
  }

  /**
   * R6b, the role an anchored doc's reach gives. Today everyone who reaches
   * an unrestricted doc edits it (and Can edit shares a doc, MANAGE_BAR), so
   * a Can view role on its Space, Folder or List gave Can edit and sharing on
   * every doc inside. A8 keeps that for the rows that gave it: rows written
   * before the cutoff and the org-wide "everyone" reach. A grant this release
   * writes follows A5 instead: the ancestor's role is the doc's role, so the
   * dialog's "Can view: Read only." holds for the docs inside too. The answer
   * is the higher of the two, so a person holding both an older row and a new
   * one keeps the older reach.
   */
  private anchoredDocRole(d: DocFact, reach: Res): Res {
    const lift = (r: Res): Res => ({ role: roleAtLeast(r.role, "FULL") ? "FULL" : "EDIT", via: r.via });
    if (reach.via.type === "everyone") return lift(reach);
    const old = this.legacyEv();
    if (!old) return lift(reach);
    const capped: Res = { role: inheritRole(reach.role), via: reach.via };
    const oldReach = old.anchorReach(d);
    if (oldReach.role === "none") return capped;
    const legacy = lift(oldReach);
    return rankOf(legacy.role) > rankOf(capped.role) ? legacy : capped;
  }

  /**
   * R7b, the role a table's Space gives, on the same terms as R6b. Today
   * everyone who reaches a Space edits every table in it (rows, columns, CSV
   * import, a form pointed at it), so a Can view role on the Space climbed to
   * Can edit on its tables. A8 keeps that for the rows that gave it: rows
   * written before the cutoff and the org-wide "everyone" reach. A grant this
   * release writes follows A5 instead: the Space role is the table's role, so
   * "Can view: Read only." holds for the tables inside too and roles never
   * climb (delta C3). The higher of the two, so an older row keeps its reach.
   */
  private spaceTableRole(spaceId: string, reach: Res): Res {
    const lift = (r: Res): Res => ({ role: roleAtLeast(r.role, "FULL") ? "FULL" : "EDIT", via: r.via });
    if (reach.via.type === "everyone") return lift(reach);
    const old = this.legacyEv();
    if (!old) return lift(reach);
    const capped: Res = { role: inheritRole(reach.role), via: reach.via };
    const oldReach = old.strict({ kind: "space", id: spaceId });
    if (oldReach.role === "none") return capped;
    const legacy = lift(oldReach);
    return rankOf(legacy.role) > rankOf(capped.role) ? legacy : capped;
  }

  /** R6c for an anchored doc: what the anchor gives. */
  private anchorReach(d: DocFact): Res {
    const id = d.entityId as string;
    switch (d.entityType) {
      case "SPACE":
        return this.strict({ kind: "space", id });
      case "FOLDER":
        return this.strict({ kind: "folder", id });
      case "BOARD":
        return this.strict({ kind: "list", id });
      case "BOARD_ITEM": {
        const item = this.rows.items.get(id);
        if (!item || !this.sameOrg(item.organizationId)) return NONE;
        return this.strict({ kind: "list", id: item.boardId });
      }
      default:
        // Today's open fallback for every other anchor type.
        return { role: "EDIT", via: { type: "everyone", node: null } };
    }
  }

  // R7
  private table(id: string): Res {
    const t = this.rows.tables.get(id);
    if (!t || !this.sameOrg(t.organizationId)) return NONE;
    const ref: NodeRef = { kind: "table", id };
    const cands: Candidate[] = [];
    let spaceReached = true;
    if (t.spaceId) {
      const s = this.strict({ kind: "space", id: t.spaceId });
      spaceReached = s.role !== "none";
      if (spaceReached) {
        const got = this.spaceTableRole(t.spaceId, s);
        cands.push({ role: got.role, via: inheritVia(got.via), prio: s.via.type === "everyone" ? P_EVERYONE : P_INHERITED });
      }
    } else if (!this.grants.viewer.orgGuest) {
      cands.push({ role: "EDIT", via: { type: "everyone", node: null }, prio: P_EVERYONE });
    }
    if (t.createdById && t.createdById === this.u && spaceReached) {
      cands.push({ role: "FULL", via: { type: "owner", node: ref }, prio: P_OWNER });
    }
    const g = this.grants.object.get(objectGrantKey("table", id));
    if (g) cands.push({ role: memberToRole(g), via: { type: "own", node: ref, source: "AccessGrant" }, prio: P_OWN });
    return pick(cands);
  }

  // R8
  private canvas(id: string): Res {
    const c = this.rows.canvases.get(id);
    if (!c || !this.sameOrg(c.organizationId)) return NONE;
    const ref: NodeRef = { kind: "canvas", id };
    const folder = canvasFolderOf(this.rows, c);
    const cands: Candidate[] = [];
    let reached: boolean;
    if (folder || c.spaceId) {
      const parentRes = folder ? this.strict({ kind: "folder", id: folder.id }) : this.strict({ kind: "space", id: c.spaceId as string });
      reached = parentRes.role !== "none";
      if (reached) cands.push(up(parentRes));
    } else {
      reached = !this.grants.viewer.orgGuest;
      if (reached) cands.push({ role: "EDIT", via: { type: "everyone", node: null }, prio: P_EVERYONE });
    }
    if (c.ownerId && c.ownerId === this.u && reached) {
      cands.push({ role: "FULL", via: { type: "owner", node: ref }, prio: P_OWNER });
    }
    const g = this.grants.object.get(objectGrantKey("canvas", id));
    if (g) cands.push({ role: memberToRole(g), via: { type: "own", node: ref, source: "AccessGrant" }, prio: P_OWN });
    return pick(cands);
  }

  // R9
  private form(id: string): Res {
    const f = this.rows.forms.get(id);
    if (!f || !this.sameOrg(f.organizationId)) return NONE;
    const ref: NodeRef = { kind: "form", id };
    const cands: Candidate[] = [];
    if (!this.grants.viewer.orgGuest) cands.push({ role: "EDIT", via: { type: "everyone", node: null }, prio: P_EVERYONE });
    if (f.createdById && f.createdById === this.u) cands.push({ role: "FULL", via: { type: "owner", node: ref }, prio: P_OWNER });
    const g = this.grants.object.get(objectGrantKey("form", id));
    if (g) cands.push({ role: memberToRole(g), via: { type: "own", node: ref, source: "AccessGrant" }, prio: P_OWN });
    return pick(cands);
  }

  /**
   * R9 RESPONSES: the creator, an org admin, or a reader of the form who also
   * reaches where its answers land. A form grant never bypasses the
   * destination (problems 5 and 18); a table grant counts as reach (W8).
   */
  formResponsesAllowed(formId: string): boolean {
    const v = this.grants.viewer;
    if (v.denied) return false;
    const f = this.rows.forms.get(formId);
    if (!f || !this.sameOrg(f.organizationId)) return false;
    if (v.orgAdmin || (f.createdById && f.createdById === v.userId)) return true;
    if (!roleAtLeast(this.effective({ kind: "form", id: formId }).role, "VIEW")) return false;
    if (f.targetBoardId) return roleAtLeast(this.effective({ kind: "list", id: f.targetBoardId }).role, "VIEW");
    if (f.targetTableId) {
      const t = this.rows.tables.get(f.targetTableId);
      if (!t || !t.spaceId) return !v.orgGuest;
      return roleAtLeast(this.effective({ kind: "table", id: t.id }).role, "VIEW");
    }
    return !v.orgGuest;
  }

  /**
   * Does the owner term (the creator's or owner's Full access) apply to this
   * viewer on this node? The panel pins such a person as the Owner. It is
   * the same condition each rule above uses: reach through the parent unless
   * the node is PRIVATE, and always for a form's creator and a note's owner.
   */
  ownerApplies(ref: NodeRef): boolean {
    const v = this.grants.viewer;
    if (v.denied) return false;
    switch (ref.kind) {
      case "space":
        return false;
      case "folder": {
        const f = this.rows.folders.get(ref.id);
        if (!f || !f.ownerId || f.ownerId !== this.u) return false;
        if (f.visibility === "PRIVATE") return true;
        const parent = folderParentOf(this.rows, f);
        return this.strict(parent ? { kind: "folder", id: parent.id } : { kind: "space", id: f.spaceId }).role !== "none";
      }
      case "list": {
        const l = this.rows.lists.get(ref.id);
        if (!l || !l.ownerId || l.ownerId !== this.u) return false;
        if (l.visibility === "PRIVATE") return true;
        const folder = listFolderOf(this.rows, l);
        const parent = folder ? this.strict({ kind: "folder", id: folder.id }) : l.spaceId ? this.strict({ kind: "space", id: l.spaceId }) : NONE;
        return parent.role !== "none";
      }
      case "doc": {
        const d = this.rows.docs.get(ref.id);
        if (!d) return false;
        const note = notepadOwnerOf(this.rows, d);
        if (note !== undefined) return note === this.u;
        if (!d.createdById || d.createdById !== this.u) return false;
        const shape = docShape(d);
        if (shape === "anchored") return this.anchorReach(d).role !== "none";
        if (shape === "subpage") {
          const parent = subpageParent(this.rows, d);
          return !!parent && this.effective({ kind: "doc", id: parent.id }).role !== "none";
        }
        return true;
      }
      case "table": {
        const t = this.rows.tables.get(ref.id);
        if (!t || !t.createdById || t.createdById !== this.u) return false;
        return !t.spaceId || this.strict({ kind: "space", id: t.spaceId }).role !== "none";
      }
      case "canvas": {
        const c = this.rows.canvases.get(ref.id);
        if (!c || !c.ownerId || c.ownerId !== this.u) return false;
        const folder = canvasFolderOf(this.rows, c);
        if (folder) return this.strict({ kind: "folder", id: folder.id }).role !== "none";
        if (c.spaceId) return this.strict({ kind: "space", id: c.spaceId }).role !== "none";
        return !v.orgGuest;
      }
      case "form": {
        const f = this.rows.forms.get(ref.id);
        return !!f && !!f.createdById && f.createdById === this.u;
      }
    }
  }

  /** R10, once per evaluator: every container with no role on the way to a node with a strict role. */
  paths(): Set<string> {
    if (this.pathSet) return this.pathSet;
    const out = new Set<string>();
    const mark = (ref: NodeRef) => {
      if (!roleAtLeast(this.strict(ref).role, "VIEW")) return;
      const chain = placementContainers(this.rows, ref);
      if (inTrashedFolder(this.rows, chain)) return;
      for (const c of chain) {
        if (this.effective(c).role === "none") out.add(refKey(c));
      }
    };
    if (!this.grants.viewer.denied) {
      for (const id of this.rows.folders.keys()) mark({ kind: "folder", id });
      for (const id of this.rows.lists.keys()) mark({ kind: "list", id });
      for (const id of this.rows.docs.keys()) mark({ kind: "doc", id });
      for (const id of this.rows.canvases.keys()) mark({ kind: "canvas", id });
      for (const id of this.rows.tables.keys()) mark({ kind: "table", id });
    }
    this.pathSet = out;
    return out;
  }

  decision(ref: NodeRef): NodeDecision {
    const eff = this.effective(ref);
    const strict = this.strict(ref);
    const container = ref.kind === "space" || ref.kind === "folder";
    return {
      role: eff.role,
      strictRole: strict.role,
      via: eff.via,
      path: container && eff.role === "none" && this.paths().has(refKey(ref)),
    };
  }
}

// ── THE PLACEMENT RULE (the founder's rule, 2026-09-25) ──────────────
//
// Every write that creates a node or changes where one lives asks the
// functions below, and nothing else: a Folder's Space or parent, a List's
// Folder, a doc's anchor or parent page, a canvas's or a table's Space or
// Folder, a form's destination, a restore into a container, and any reorder
// that changes a parent. It is planned by the worst case of each situation:
// a person with a narrow grant reshaping or breaking a structure other
// people depend on, and a person with Can view creating content.
//
//   P1  CREATE inside a container needs Can edit or higher on that
//       container. Can view and Can comment never create, and a locked page
//       reads as Can comment below Full access, so only a Full holder adds a
//       sub-page to it. Nothing is made in a Folder in Trash or in an archived
//       Space (derivePlacement, docPlaceLive). At the org root (no Space) the
//       kinds that may live there keep today's rule: a doc, a table and a form
//       for anyone signed in, a canvas and a file for Members. A copy is made
//       where its source lives, and a copy of a restricted doc keeps the
//       restriction and needs the role that may change who opens the source
//       (docCopyVerdict). (createDecision)
//   P2  MOVE needs Full access on the node, Full access on the container it
//       leaves, and Can edit or higher on the container it goes to. Nothing
//       more: a Full holder of a Folder in one Space and of a Folder in
//       another moves what is inside the first into the second. The org root
//       is the one destination no one holds a role on, and landing there
//       opens the node to the whole org, so a move out of every Space also
//       needs Full access on the Space it leaves, and Full access on the node
//       that goes with it (its owner, an org admin, a Full share on a doc):
//       a Space manager's push of someone else's node out of every Space was
//       a one-way door, open to the org and theirs no longer to bring back
//       (fullWhereItLands). A Folder moves with everything beneath it, so
//       it needs Full access on all of it, as its delete does, unless the
//       mover manages its Space (folderMoveAllowed). A canvas's or a table's
//       own grant never moves it (M3). (moveVerdict)
//   P3  The Space of anything is derived from its destination parent, never
//       taken from the request: a Space that disagrees with the parent Folder
//       is refused, a parent in another org or in Trash is refused
//       (derivePlacement), a sub-page's anchor must be its parent page's
//       (anchorAgreesWithParent), and a Folder moves with its whole subtree
//       in one transaction (node-placement.ts writes it).
//   P4  A change of position under the same parent is a reorder, not a move:
//       it needs what reordering needs today, Full access on the node and on
//       the parent (moveVerdict answers `same`). A reorder that changes the
//       parent is a move under P2.
//   P5  The Move dialog offers exactly the destinations P2 accepts
//       (node-placement.ts moveDestinations asks moveVerdict per place, and
//       offers nothing for a Folder P2 refuses on what it carries), and a
//       Space's Move dialog exactly the parents spaceNestVerdict accepts.
//       A create menu or picker offers exactly the places P1 accepts
//       (node-placement.ts createDestinations asks createDecision per place).
//   P6  A refusal is a 403 with one plain sentence naming what is needed
//       (moveRefusal, createRefusal), and nothing is written.
//   P7  Org admins keep Full access everywhere (R1). A Space OWNER or ADMIN
//       row from before the cutoff keeps making and moving Lists and Folders
//       into every Folder of that Space (A8, legacyManagesSpace). A Full
//       holder of both ends moves as before.

/** What a create or a move places. */
export type PlaceKind = "folder" | "list" | "doc" | "canvas" | "table" | "form" | "file";

/**
 * Where a node lives or goes: a Space (its root), a Folder, a List (a doc on
 * a List or on one of its tasks), a parent page, or null for the org root.
 */
export type Place = NodeRef | null;

const HOLDS: Readonly<Record<PlaceKind, ReadonlySet<NodeKind | "root">>> = {
  folder: new Set(["space", "folder"]),
  list: new Set(["space", "folder"]),
  doc: new Set(["space", "folder", "list", "doc", "root"]),
  canvas: new Set(["space", "folder", "root"]),
  table: new Set(["space", "root"]),
  form: new Set(["root"]),
  file: new Set(["space", "folder", "root"]),
};

/** Can this kind live in this place at all (a table never sits in a Folder, a List never at the org root)? */
export function placeHolds(place: Place, what: PlaceKind): boolean {
  return HOLDS[what].has(place ? place.kind : "root");
}

/** The kind a node ref places as, or null for a Space (Space nesting is spaces/[id]/move's). */
export function placeKindOf(ref: NodeRef): PlaceKind | null {
  return ref.kind === "space" ? null : ref.kind;
}

/** Is a Folder, or any Folder above it, in Trash? Nothing is made or moved into one. */
function folderInTrash(rows: NodeRows, folderId: string): boolean {
  const f = rows.folders.get(folderId);
  if (!f) return false;
  if (f.archived) return true;
  return folderAncestors(rows, f).some((a) => a.archived === true);
}

/** P1 over one evaluator. */
function createAllowed(ev: NodeEvaluator, place: Place, what: PlaceKind): boolean {
  const rows = ev.rows;
  const v = ev.grants.viewer;
  if (v.denied || !placeHolds(place, what)) return false;
  if (!place) return what === "doc" || what === "table" || what === "form" ? true : v.orgAdmin || !v.orgGuest;
  if (place.kind === "folder" && folderInTrash(rows, place.id)) return false;
  // A locked page reads as Can comment below Full access (applyDocLock), and
  // Can comment never creates: a new sub-page, a copy of one or a page moved
  // in is content added to the locked page itself (round three, break 3).
  const role = place.kind === "doc" ? applyDocLock(ev.effective(place).role, rows.docs.get(place.id)?.locked === true) : ev.effective(place).role;
  if (roleAtLeast(role, "EDIT")) return true;
  // P7: a Space OWNER or ADMIN from before the cutoff made Lists and Folders
  // in every Folder of their Space, a Private one that does not name them
  // included (A8). Only those two kinds: nothing else was theirs to make there.
  return place.kind === "folder" && (what === "list" || what === "folder") && ev.legacyManagesSpace(rows.folders.get(place.id)?.spaceId);
}

/**
 * P1. May this viewer create `what` in `place` (null: the org root)? Can edit
 * or higher on the container; Can view and Can comment never create.
 */
export function createDecision(rows: NodeRows, grants: ViewerGrants, place: Place, what: PlaceKind): boolean {
  return createAllowed(new NodeEvaluator(rows, grants), place, what);
}

/** The Space a place is in, or null (the org root, or a place this world does not hold). */
export function spaceOfPlace(rows: NodeRows, place: Place): string | null {
  if (!place) return null;
  switch (place.kind) {
    case "space":
      return rows.spaces.has(place.id) ? place.id : null;
    case "folder":
      return rows.folders.get(place.id)?.spaceId ?? null;
    case "list":
      return rows.lists.get(place.id)?.spaceId ?? null;
    case "doc": {
      const top = placementContainers(rows, place);
      const last = top[top.length - 1];
      return last?.kind === "space" ? last.id : null;
    }
    default:
      return null;
  }
}

/** The Space a node sits in now, from the chain the resolver reads (a stale parent reads as the Space it names). */
function spaceOfNode(rows: NodeRows, ref: NodeRef): string | null {
  const chain = placementContainers(rows, ref);
  const last = chain[chain.length - 1];
  return last?.kind === "space" ? last.id : null;
}

/**
 * Where a node lives now: the container P2 calls "what it leaves". A Folder's
 * parent Folder or its Space root; a List's, a canvas's Folder or Space (or
 * null: no Space); a table's Space; a doc's parent page, else its anchor
 * (a task's doc lives on the task's List), else the org root. Undefined when
 * the world does not hold the node, and for what never moves this way (a
 * Space, a note).
 */
export function currentPlace(rows: NodeRows, ref: NodeRef): Place | undefined {
  switch (ref.kind) {
    case "space":
      return undefined;
    case "folder": {
      const f = rows.folders.get(ref.id);
      if (!f) return undefined;
      const parent = folderParentOf(rows, f);
      return parent ? { kind: "folder", id: parent.id } : { kind: "space", id: f.spaceId };
    }
    case "list": {
      const l = rows.lists.get(ref.id);
      if (!l) return undefined;
      const f = listFolderOf(rows, l);
      return f ? { kind: "folder", id: f.id } : l.spaceId ? { kind: "space", id: l.spaceId } : null;
    }
    case "canvas": {
      const c = rows.canvases.get(ref.id);
      if (!c) return undefined;
      const f = canvasFolderOf(rows, c);
      return f ? { kind: "folder", id: f.id } : c.spaceId ? { kind: "space", id: c.spaceId } : null;
    }
    case "table": {
      const t = rows.tables.get(ref.id);
      if (!t) return undefined;
      return t.spaceId ? { kind: "space", id: t.spaceId } : null;
    }
    case "form":
      return rows.forms.has(ref.id) ? null : undefined;
    case "doc": {
      const d = rows.docs.get(ref.id);
      if (!d) return undefined;
      if (notepadOwnerOf(rows, d) !== undefined) return undefined;
      if (d.parentId) {
        const parent = rows.docs.get(d.parentId);
        if (parent && parent.organizationId === d.organizationId) return { kind: "doc", id: parent.id };
      }
      return docAnchorPlace(rows, d.entityType, d.entityId);
    }
  }
}

/**
 * The place a doc anchor names: a Space, a Folder, a List, or the List of a
 * task. Null for no anchor and for every other anchor type (today's open
 * fallback, the org's). A task this world does not hold reads as null.
 */
export function docAnchorPlace(rows: NodeRows, entityType: string | null, entityId: string | null): Place {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "SPACE":
      return { kind: "space", id: entityId };
    case "FOLDER":
      return { kind: "folder", id: entityId };
    case "BOARD":
      return { kind: "list", id: entityId };
    case "BOARD_ITEM": {
      const item = rows.items.get(entityId);
      return item ? { kind: "list", id: item.boardId } : null;
    }
    default:
      return null;
  }
}

function samePlace(a: Place, b: Place): boolean {
  if (!a || !b) return a === b;
  return sameRef(a, b);
}

/** Full access on a container, or (a Folder) today's canEditSpace on its Space under the legacy rule (P7). */
function managesPlace(ev: NodeEvaluator, place: NodeRef): boolean {
  if (roleAtLeast(ev.effective(place).role, "FULL")) return true;
  return place.kind === "folder" && ev.legacyManagesSpace(ev.rows.folders.get(place.id)?.spaceId);
}

/**
 * The containers a move from `from` to `dest` leaves (P2): the one it sits in.
 * A move out of every Space (dest null, the org root) also leaves its Space,
 * because the org root is no container anyone holds a role on and landing
 * there opens the node to the whole org. A move into another Space's tree
 * asks nothing more of the Space it leaves: Can edit where it lands is the
 * other end, exactly as P2 states it.
 */
function leftContainers(rows: NodeRows, ref: NodeRef, from: Place, dest: Place): NodeRef[] {
  if (!from) return [];
  const out: NodeRef[] = [from];
  if (dest === null) {
    const source = spaceOfNode(rows, ref);
    if (source && !(from.kind === "space" && from.id === source)) out.push({ kind: "space", id: source });
  }
  return out;
}

/**
 * Does this move take the node out of every Space: to the org root, or under
 * a page (or onto a List) that lives in no Space? Such a node leaves every
 * container a role is held on, and opens to whoever its new home opens to.
 */
export function leavesEverySpace(rows: NodeRows, ref: NodeRef, dest: Place): boolean {
  return spaceOfNode(rows, ref) !== null && spaceOfPlace(rows, dest) === null;
}

/**
 * The world with one node set down at `dest`, so the role it would carry
 * there can be read by the one resolver. Only the kinds that can leave every
 * Space (a canvas, a table, a doc); null for every other kind.
 */
function rowsWithNodeAt(rows: NodeRows, ref: NodeRef, dest: Place): NodeRows | null {
  switch (ref.kind) {
    case "canvas": {
      const c = rows.canvases.get(ref.id);
      if (!c) return null;
      const canvases = new Map(rows.canvases);
      canvases.set(ref.id, { ...c, spaceId: spaceOfPlace(rows, dest), folderId: dest?.kind === "folder" ? dest.id : null });
      return { ...rows, canvases };
    }
    case "table": {
      const t = rows.tables.get(ref.id);
      if (!t) return null;
      const tables = new Map(rows.tables);
      tables.set(ref.id, { ...t, spaceId: dest?.kind === "space" ? dest.id : null });
      return { ...rows, tables };
    }
    case "doc": {
      const d = rows.docs.get(ref.id);
      if (!d) return null;
      const anchor: Readonly<Record<string, string>> = { space: "SPACE", folder: "FOLDER", list: "BOARD" };
      const type = dest ? anchor[dest.kind] ?? null : null;
      const at = !dest
        ? { entityType: null, entityId: null, parentId: null }
        : dest.kind === "doc"
          ? { entityType: null, entityId: null, parentId: dest.id }
          : { entityType: type, entityId: type ? dest.id : null, parentId: null };
      const docs = new Map(rows.docs);
      docs.set(ref.id, { ...d, ...at });
      return { ...rows, docs };
    }
    default:
      return null;
  }
}

/**
 * P2 at the edge of every Space: does the viewer hold Full access on the node
 * where it would land, from the node itself (its owner, an org admin, or a
 * Full share on a doc) rather than from the Space it leaves? A canvas's or a
 * table's own grant never moves it (M3), here as everywhere.
 */
export function fullWhereItLands(rows: NodeRows, grants: ViewerGrants, ref: NodeRef, dest: Place): boolean {
  if (grants.viewer.denied) return false;
  const moved = rowsWithNodeAt(rows, ref, dest);
  if (!moved) return false;
  let g = grants;
  if (ref.kind === "canvas" || ref.kind === "table") {
    const key = objectGrantKey(ref.kind, ref.id);
    if (grants.object.has(key)) g = { ...grants, object: new Map([...grants.object].filter(([k]) => k !== key)) };
  }
  return roleAtLeast(new NodeEvaluator(moved, g).effective(ref).role, "FULL");
}

/**
 * Why a move is refused: the node itself, the place it leaves, the place it
 * goes, or (out of every Space) a Full access that would not go with it.
 */
export type MoveFailure = "node" | "source" | "destination" | "landing";

export type MoveVerdict =
  | { ok: true; same: boolean }
  | { ok: false; failure: MoveFailure };

/**
 * P2 and P4. May this viewer move `ref` to `dest` (null: the org root, out of
 * every Space)? `same` is a reorder under the parent it already has (P4),
 * which needs Full access on the node and on that parent, as reordering does
 * today. Anything else is a move: Full access on the node, Full access on
 * the container it leaves, and Can edit or higher where it goes (P1's create
 * rule); a move out of every Space (dest null) also needs Full access on the
 * Space it leaves. Org admins pass on R1; a Space OWNER or ADMIN from before
 * the cutoff on P7.
 *
 * An Agent moves like anyone else, as every move gate before node-access did
 * (A8): the Agent clamp is Phase 8's to decide.
 */
export function moveVerdict(rows: NodeRows, grants: ViewerGrants, ref: NodeRef, dest: Place): MoveVerdict {
  const what = placeKindOf(ref);
  if (grants.viewer.denied || !what) return { ok: false, failure: "node" };
  const from = currentPlace(rows, ref);
  if (from === undefined) return { ok: false, failure: "node" };
  const ev = new NodeEvaluator(rows, grants);
  // The node itself. M3: a canvas's or a table's own grant never moves it.
  let nodeEv = ev;
  if (ref.kind === "canvas" || ref.kind === "table") {
    const key = objectGrantKey(ref.kind, ref.id);
    if (grants.object.has(key)) {
      nodeEv = new NodeEvaluator(rows, { ...grants, object: new Map([...grants.object].filter(([k]) => k !== key)) });
    }
  }
  if (!roleAtLeast(nodeEv.effective(ref).role, "FULL")) return { ok: false, failure: "node" };
  // P4: the parent it already has.
  if (samePlace(from, dest)) {
    if (from && !managesPlace(ev, from)) return { ok: false, failure: "source" };
    return { ok: true, same: true };
  }
  // P2: what it leaves, then where it goes.
  for (const c of leftContainers(rows, ref, from, dest)) {
    if (!managesPlace(ev, c)) return { ok: false, failure: "source" };
  }
  if (!createAllowed(ev, dest, what)) return { ok: false, failure: "destination" };
  // P2 out of every Space: the node's Full access must go with it. A Space
  // manager's Full access on someone else's canvas, doc or table ends at the
  // Space's edge, so their push would be a one-way door: the node open to
  // the whole org and nobody but its owner able to bring it back.
  if (leavesEverySpace(rows, ref, dest) && !fullWhereItLands(rows, grants, ref, dest)) return { ok: false, failure: "landing" };
  return { ok: true, same: false };
}

/**
 * The boolean form of moveVerdict, for the callers that only branch on it
 * (null: out of every Space). A reorder under the same parent reads as
 * allowed only when P4 allows it.
 */
export function moveDecision(rows: NodeRows, grants: ViewerGrants, ref: NodeRef, destRef: NodeRef | null): boolean {
  return moveVerdict(rows, grants, ref, destRef).ok;
}

/**
 * P2 for a file placed in the Space tree (a Space's root or one of its
 * Folders). A file has no role of its own, so "Full access on the node" is
 * its uploader, an org admin, or Full access on where it is now; the rest is
 * P2 as for every node: Full access on the place it leaves and Can edit
 * where it goes (P1's create rule for a file), and out of every Space (dest
 * null) also Full access on the Space it leaves. A file in no Space moves by
 * its uploader (or an admin) alone.
 */
export function fileMoveVerdict(
  rows: NodeRows,
  grants: ViewerGrants,
  file: { spaceId: string | null; spaceFolderId: string | null; uploadedById: string | null },
  dest: Place,
): MoveVerdict {
  const v = grants.viewer;
  if (v.denied) return { ok: false, failure: "node" };
  const ev = new NodeEvaluator(rows, grants);
  const from = filePlace(file);
  const own = v.orgAdmin || (!!file.uploadedById && file.uploadedById === v.userId);
  if (!own && !(from && managesPlace(ev, from))) return { ok: false, failure: "node" };
  if (samePlace(from, dest)) return { ok: true, same: true };
  if (from) {
    if (!managesPlace(ev, from)) return { ok: false, failure: "source" };
    const source = spaceOfPlace(rows, from);
    if (dest === null && source && from.kind !== "space" && !managesPlace(ev, { kind: "space", id: source })) {
      return { ok: false, failure: "source" };
    }
  }
  if (!createAllowed(ev, dest, "file")) return { ok: false, failure: "destination" };
  // Out of every Space a file moves by its uploader or an admin alone, so a
  // Space manager who pushed someone else's file out could never bring it
  // back: only the people who keep Full access on it there take it out.
  if (from && dest === null && !own) return { ok: false, failure: "landing" };
  return { ok: true, same: false };
}

/** Where a file sits in the Space tree: its Folder, its Space's root, or null (the org's). */
export function filePlace(file: { spaceId: string | null; spaceFolderId: string | null }): Place {
  return file.spaceFolderId ? { kind: "folder", id: file.spaceFolderId } : file.spaceId ? { kind: "space", id: file.spaceId } : null;
}

/**
 * May this viewer change a file's own content (its name, its description, its
 * drive folder) or put it in Trash? A file has no role of its own, so a file
 * in the Space tree takes the role of where it sits: Can edit on its Folder or
 * its Space's root (P1's rule for writing in a container, the role that makes
 * a file there), or an org admin. Uploading it once is not a standing right:
 * a person lowered to Can view keeps their hands off what is now read only
 * for them. A file of the org's (no Space) keeps today's rule: its uploader
 * or any Member. Can view and Can comment never change or remove a file in a
 * container: the worst case is a narrow grant breaking content others depend
 * on.
 */
export function fileEditDecision(
  rows: NodeRows,
  grants: ViewerGrants,
  file: { spaceId: string | null; spaceFolderId: string | null; uploadedById: string | null },
): boolean {
  const v = grants.viewer;
  if (v.denied) return false;
  if (v.orgAdmin) return true;
  const place = filePlace(file);
  if (!place) return !v.orgGuest || (!!file.uploadedById && file.uploadedById === v.userId);
  return roleAtLeast(new NodeEvaluator(rows, grants).effective(place).role, "EDIT");
}

const PLACE_NOUN: Readonly<Record<PlaceKind, string>> = {
  folder: "folder", list: "List", doc: "doc", canvas: "canvas", table: "table", form: "form", file: "file",
};

const CONTAINER_NOUN: Readonly<Partial<Record<NodeKind, string>>> = {
  space: "Space", folder: "folder", list: "List", doc: "page",
};

/** P6: the one sentence a refused move answers with. */
export function moveRefusal(what: PlaceKind, failure: MoveFailure): string {
  const noun = PLACE_NOUN[what];
  if (failure === "node") return `You need Full access to this ${noun} to move it.`;
  if (failure === "landing") return `You need Full access to this ${noun} itself, not only through its Space, to take it out of every Space.`;
  return `You need Full access where this ${noun} is now and Can edit where it is going.`;
}

/** P6: the one sentence a refused create answers with. */
export function createRefusal(what: PlaceKind, place: Place): string {
  const noun = PLACE_NOUN[what];
  const article = /^[aeiou]/i.test(noun) ? "an" : "a";
  if (!place) return `Only members of the workspace can add ${article} ${noun} outside a Space.`;
  if (!placeHolds(place, what)) return `${article === "an" ? "An" : "A"} ${noun} can't be added there.`;
  return `You need Can edit on this ${CONTAINER_NOUN[place.kind] ?? "place"} to add ${article} ${noun} to it.`;
}

/** A container row as P3 checks it: its org, its Space (a Folder's) and whether it is in Trash. */
export interface PlacementFolderFact { id: string; organizationId: string; spaceId: string; inTrash: boolean }
export interface PlacementSpaceFact { id: string; organizationId: string; archived: boolean }

export type Placement =
  | { ok: true; spaceId: string | null; folderId: string | null }
  | { ok: false; status: 400 | 404; message: string };

/**
 * P3. Where a create or a move lands, derived from its parent. A named Folder
 * settles the Space: a request Space that disagrees is refused, and so is a
 * Folder in another org or in Trash. With no Folder the request's Space is
 * the place (it must be in the org and not archived); with neither, the org
 * root when the kind may live there (`root`), else a 400. `found` holds the
 * rows the caller read for the ids the request named (a Folder, and the Space
 * it settles or the request names), or null for an id that matched no row.
 */
export function derivePlacement(
  organizationId: string,
  req: { spaceId?: string | null; folderId?: string | null },
  found: { folder?: PlacementFolderFact | null; space?: PlacementSpaceFact | null },
  opts: { root?: boolean } = {},
): Placement {
  const folderId = req.folderId || null;
  if (folderId) {
    const f = found.folder;
    if (!f || f.id !== folderId || f.organizationId !== organizationId) return { ok: false, status: 404, message: "That folder no longer exists." };
    if (f.inTrash) return { ok: false, status: 400, message: "That folder is in Trash." };
    if (req.spaceId && req.spaceId !== f.spaceId) return { ok: false, status: 400, message: "That folder is in another Space." };
    const s = found.space;
    if (!s || s.id !== f.spaceId || s.organizationId !== organizationId) return { ok: false, status: 404, message: "That Space no longer exists." };
    if (s.archived) return { ok: false, status: 400, message: "That Space is archived." };
    return { ok: true, spaceId: f.spaceId, folderId };
  }
  const spaceId = req.spaceId || null;
  if (!spaceId) return opts.root ? { ok: true, spaceId: null, folderId: null } : { ok: false, status: 400, message: "Pick a Space." };
  const s = found.space;
  if (!s || s.id !== spaceId || s.organizationId !== organizationId) return { ok: false, status: 404, message: "That Space no longer exists." };
  if (s.archived) return { ok: false, status: 400, message: "That Space is archived." };
  return { ok: true, spaceId, folderId: null };
}

/**
 * P3 for docs: a doc that names both a parent page and an anchor must name
 * the anchor its parent page lives under. A sub-page lives where its parent
 * lives; a split (a page of a Folder in one Space anchored to another Space)
 * is refused. No anchor always agrees (the page follows its parent, A6).
 */
export function anchorAgreesWithParent(anchor: { entityType: string | null; entityId: string | null } | null, parentHome: DocHome): boolean {
  if (!anchor?.entityType || !anchor.entityId) return true;
  return parentHome.kind === "anchor" && parentHome.entityType === anchor.entityType && parentHome.entityId === anchor.entityId;
}

export type DocCopyVerdict = { ok: true; carry: DocSharingFact | null } | { ok: false };

/**
 * P1 for a copy of a doc made beside it (POST /api/docs/[id]/duplicate). The
 * copy is content added where the source lives, so the caller also asks the
 * create rule there (Can edit). A source restricted on its own entry hides
 * its content from the place it lives in, and an open copy would hand that
 * content to everyone the restriction keeps it from: a Can view holder once
 * copied a restricted salary table into a copy the whole Folder read (round
 * three, break 4). So:
 *   - the copy keeps the restriction and the people listed (`carry`), with
 *     the source's creator kept at Full access, so the owner of restricted
 *     content never loses sight of a copy of it; the public link never
 *     carries;
 *   - only someone who may change who opens the source makes one: Can edit on
 *     the source before its lock (MANAGE_BAR for a doc). Its copier is its
 *     creator, with Full access on the copy, so a Can view or Can comment
 *     holder would otherwise hold a copy they could open to everyone.
 * A page under a restricted parent is not itself restricted: its copy sits
 * under the same parent, and keeps the same readers without a carry.
 */
export function docCopyVerdict(
  source: DocSharingFact | undefined,
  sourceRole: NodeRole,
  who: { sourceCreatorId: string | null; copierId: string },
): DocCopyVerdict {
  if (!source?.restricted) return { ok: true, carry: null };
  if (!roleAtLeast(sourceRole, "EDIT")) return { ok: false };
  const carry: DocSharingFact = { restricted: true };
  if (source.members && Object.keys(source.members).length) carry.members = { ...source.members };
  const roles: Record<string, ObjectRole> = { ...(source.roles ?? {}) };
  if (who.sourceCreatorId && who.sourceCreatorId !== who.copierId) roles[who.sourceCreatorId] = "FULL";
  if (Object.keys(roles).length) carry.roles = roles;
  return { ok: true, carry };
}

/** P6: the sentence a refused copy of a restricted doc answers with. */
export const RESTRICTED_COPY_REFUSAL = "This doc is restricted, so only people with Can edit on it can copy it. A copy keeps the restriction.";

/**
 * P3 for a page's new parent: would the doc end up under itself? `chain` is
 * the page chain above the new parent, the parent first, read under the lock
 * every re-parent in the org takes (node-placement writeDocTreeMove). The doc
 * on that chain is a loop. A chain that repeats a page already loops, and a
 * page put under it would reach nobody (R6 reads a loop as closed), so it is
 * refused the same way. Never an orphan, never a cycle.
 */
export function docNestLoops(docId: string, chain: readonly string[]): boolean {
  if (chain.includes(docId)) return true;
  return new Set(chain).size !== chain.length;
}

/** The doc anchors that are places in the Space tree: the ones a move writes and P3 keeps in step. */
export const PLACE_ANCHORS: ReadonlySet<string> = new Set(["SPACE", "FOLDER", "BOARD", "BOARD_ITEM"]);

export type SubtreeAnchorPlan = { ok: true; rewrite: string[] } | { ok: false };

/**
 * P3 for a page tree that moves. A sub-page may carry its own anchor (made
 * where its parent lived, which anchorAgreesWithParent allows), so moving the
 * parent alone used to leave that page in the old Folder or Space under a
 * parent in the new one: readers of the new place saw the parent and not the
 * page, readers of the old place the page and not its parent. So every page
 * beneath the moved doc that carries a place anchor takes the moved doc's new
 * home in the same write (`rewrite`, the ids to change). When the new home is
 * no place (the org root, or a chain R6 reads as closed) such a page has no
 * consistent home, and the move is refused rather than split. A note
 * (NOTEPAD) below is its owner's alone and is left untouched.
 */
export function subtreeAnchorPlan(
  homeAfter: DocHome,
  descendants: ReadonlyArray<{ id: string; entityType: string | null; entityId: string | null }>,
): SubtreeAnchorPlan {
  const placed = descendants.filter((d) => !!d.entityType && !!d.entityId && PLACE_ANCHORS.has(d.entityType));
  if (placed.length === 0) return { ok: true, rewrite: [] };
  if (homeAfter.kind !== "anchor" || !PLACE_ANCHORS.has(homeAfter.entityType)) return { ok: false };
  return {
    ok: true,
    rewrite: placed.filter((d) => d.entityType !== homeAfter.entityType || d.entityId !== homeAfter.entityId).map((d) => d.id),
  };
}

export type SpaceNestVerdict = { ok: true; same: boolean } | { ok: false; status: 400 | 403 | 404; error: string };

/** P6 for Space nesting: the one sentence both halves of a refused move answer with. */
export const SPACE_NEST_REFUSAL = "You need Full access on the Space this one sits in now and on the Space it is going into.";

/**
 * P2 for nesting a Space under another, or taking it to the top level (dest
 * null). A sub-Space's place under its parent is the parent's structure, so a
 * move needs Full access on the Space itself, Full access on the parent it
 * leaves, and Full access on the parent it goes under (Space nesting has
 * always asked Full access at both ends: a sub-Space is no content a Can edit
 * holder adds). The parent it already has is no move. A parent that is the
 * Space itself, one of its own sub-Spaces, in another org, out of the
 * viewer's sight or archived is refused, archived as every other placement
 * refuses it (P3).
 */
export function spaceNestVerdict(input: {
  spaceId: string;
  managesSpace: boolean;
  /** The parent it has now, or null at the top level. */
  current: { id: string; manages: boolean } | null;
  /** The parent it goes under, or null for the top level. */
  dest: { id: string; found: boolean; sees: boolean; archived: boolean; manages: boolean; cycle: boolean } | null;
}): SpaceNestVerdict {
  const { spaceId, current, dest } = input;
  if (!input.managesSpace) return { ok: false, status: 403, error: "You need Full access to this Space to move it." };
  if ((current?.id ?? null) === (dest?.id ?? null)) return { ok: true, same: true };
  if (dest) {
    if (dest.id === spaceId) return { ok: false, status: 400, error: "A Space can't be moved into itself." };
    if (!dest.found || !dest.sees) return { ok: false, status: 404, error: "Destination Space not found." };
    if (dest.archived) return { ok: false, status: 400, error: "That Space is archived." };
    if (dest.cycle) return { ok: false, status: 400, error: "Can't move a Space into one of its own sub-Spaces." };
  }
  if (current && !current.manages) return { ok: false, status: 403, error: SPACE_NEST_REFUSAL };
  if (dest && !dest.manages) return { ok: false, status: 403, error: SPACE_NEST_REFUSAL };
  return { ok: true, same: false };
}

/**
 * The one containment gate of a delete that takes a Folder's subtree with it
 * (Trash or archive): Full access on the Folder, and on everything it takes
 * (every sub-folder, List and canvas beneath it), unless the viewer manages
 * the Folder's Space (Full access on it, or P7). A narrow grant never takes
 * away what other people were given inside it.
 */
export function folderDeleteAllowed(
  rows: NodeRows,
  grants: ViewerGrants,
  folderId: string,
  inside: { folders: readonly string[]; lists: readonly string[]; canvases: readonly string[] },
): boolean {
  if (grants.viewer.denied) return false;
  const ev = new NodeEvaluator(rows, grants);
  const f = rows.folders.get(folderId);
  if (!f || !roleAtLeast(ev.effective({ kind: "folder", id: folderId }).role, "FULL")) return false;
  if (roleAtLeast(ev.effective({ kind: "space", id: f.spaceId }).role, "FULL") || ev.legacyManagesSpace(f.spaceId)) return true;
  const full = (ref: NodeRef) => roleAtLeast(ev.effective(ref).role, "FULL");
  return (
    inside.folders.every((id) => full({ kind: "folder", id })) &&
    inside.lists.every((id) => full({ kind: "list", id })) &&
    inside.canvases.every((id) => full({ kind: "canvas", id }))
  );
}

/**
 * P2 for a Folder that changes parent: it moves with everything beneath it,
 * so the move needs what its delete needs (folderDeleteAllowed): Full access
 * on the Folder and on every sub-folder, List and canvas it carries, unless
 * the viewer manages the Folder's Space. A Private sub-folder (or List) the
 * mover cannot open, or holds less than Full access on, is someone else's
 * structure: a narrow grant never carries it into another place, where its
 * people could lose it and the mover could not put it back. A reorder under
 * the same parent moves nothing and never asks this (P4).
 */
export function folderMoveAllowed(
  rows: NodeRows,
  grants: ViewerGrants,
  folderId: string,
  inside: { folders: readonly string[]; lists: readonly string[]; canvases: readonly string[] },
): boolean {
  return folderDeleteAllowed(rows, grants, folderId, inside);
}

/** P6: the one sentence a Folder move refused on what it carries answers with. */
export const FOLDER_SUBTREE_MOVE_REFUSAL = "You need Full access to everything in this folder to move it.";

/**
 * Does this move take a doc out of every place? A doc with an anchor or a
 * parent page that ends with neither becomes a root doc, which the whole org
 * opens (R6): a change to who can open it, so the route asks for Full access
 * on the doc, or today's answer (A8), before it lets a Can edit holder do it.
 */
export function docLeavesEveryPlace(
  before: { entityType: string | null; entityId: string | null; parentId: string | null },
  after: { entityType: string | null; entityId: string | null; parentId: string | null },
): boolean {
  const placedBefore = !!(before.entityType && before.entityId) || !!before.parentId;
  const placedAfter = !!(after.entityType && after.entityId) || !!after.parentId;
  return placedBefore && !placedAfter;
}

/**
 * Where a page chain lives: the anchor of the first anchored page on it (the
 * doc itself when anchored), "root" for a chain that ends at a page with no
 * anchor, or "closed" for a chain R6 reads as reaching nobody (a missing or
 * foreign parent, a loop, deeper than eight pages).
 */
export type DocHome =
  | { kind: "anchor"; entityType: string; entityId: string }
  | { kind: "root" }
  | { kind: "closed" };

/** The anchors whose reach is a set of people (anchorReach); every other anchor type is today's open fallback. */
const CONFINING_ANCHORS = new Set(["SPACE", "FOLDER", "BOARD", "BOARD_ITEM", "NOTEPAD"]);

/**
 * Does a doc living at this home reach only a set of people, never the whole
 * org by default? A root chain is the org's unless a restricted page on it
 * keeps it to the people listed.
 */
export function docHomeConfines(home: DocHome, restrictedAbove: boolean): boolean {
  if (home.kind === "closed") return true;
  if (home.kind === "anchor") return CONFINING_ANCHORS.has(home.entityType);
  return restrictedAbove;
}

/**
 * Does this tree move need Full access on the doc (or today's answer, A8)?
 * Anything that can open the doc to the whole org does:
 *   - dropping its own anchor, with or without a new parent page: under the
 *     legacy rule a page made before the cutoff with no anchor keeps today's
 *     org-wide floor (R11), so even a sub-page of a page in the same Folder
 *     would open to everyone;
 *   - leaving every place (a root doc);
 *   - nesting under a page whose chain is the org's while the doc lived in a
 *     Space, Folder, List or restricted page tree.
 * A Can edit holder still moves a doc between places they reach, and still
 * reorders or nests it while it keeps its own anchor.
 */
export function docMoveNeedsFull(
  before: { entityType: string | null; entityId: string | null; parentId: string | null },
  after: { entityType: string | null; entityId: string | null; parentId: string | null },
  confined: { before: boolean; after: boolean },
): boolean {
  const anchoredBefore = !!(before.entityType && before.entityId);
  const anchoredAfter = !!(after.entityType && after.entityId);
  if (anchoredBefore && !anchoredAfter) return true;
  if (docLeavesEveryPlace(before, after)) return true;
  return confined.before && !confined.after;
}

/** THE decision for one node. */
export function decide(rows: NodeRows, grants: ViewerGrants, ref: NodeRef): NodeDecision {
  return new NodeEvaluator(rows, grants).decision(ref);
}

/** Every node the world holds (or the refs given), over one evaluator. Keys are refKey(ref). */
export function decideAll(rows: NodeRows, grants: ViewerGrants, refs?: NodeRef[]): Map<string, NodeDecision> {
  const ev = new NodeEvaluator(rows, grants);
  const out = new Map<string, NodeDecision>();
  const list = refs ?? allRefs(rows);
  for (const ref of list) out.set(refKey(ref), ev.decision(ref));
  return out;
}

/** The R10 path containers of this world for this viewer, as refKey strings. */
export function pathContainers(rows: NodeRows, grants: ViewerGrants): Set<string> {
  return new NodeEvaluator(rows, grants).paths();
}

export function allRefs(rows: NodeRows): NodeRef[] {
  const out: NodeRef[] = [];
  for (const id of rows.spaces.keys()) out.push({ kind: "space", id });
  for (const id of rows.folders.keys()) out.push({ kind: "folder", id });
  for (const id of rows.lists.keys()) out.push({ kind: "list", id });
  for (const id of rows.docs.keys()) out.push({ kind: "doc", id });
  for (const id of rows.tables.keys()) out.push({ kind: "table", id });
  for (const id of rows.canvases.keys()) out.push({ kind: "canvas", id });
  for (const id of rows.forms.keys()) out.push({ kind: "form", id });
  return out;
}

// ── what changes against today ──────────────────────────────────────

export interface NodeAccessDelta {
  id: string;
  /** "strict": only once a workspace applies the strict Private rule; "always": on deploy. */
  mode: "strict" | "always";
  kind: "narrowing" | "widening" | "information" | "api";
  text: string;
  /** Where today's answer came from. */
  legacySource: string;
}

/**
 * Every place node-access answers differently from the helpers it replaced.
 * The parity grid in node-rules.test.ts proves that every world today's
 * helpers admit still reads, except the rows named here, and the dry-run
 * report (scripts/report-folder-overgrants.ts section C) lists the people each
 * strict row would affect before an admin applies the rule.
 */
export const NODE_ACCESS_DELTAS: readonly NodeAccessDelta[] = [
  {
    id: "N1",
    mode: "strict",
    kind: "narrowing",
    text: "Private sub-folder: an ancestor Folder grant or a Space row no longer reaches a Private Folder that does not name the person.",
    legacySource: "parity.ts legacyFolderReadable read the nearest ancestor FolderMember before the PRIVATE check (folder.ts:188-197).",
  },
  {
    id: "N2",
    mode: "strict",
    kind: "narrowing",
    text: "Below a Private Folder: Lists, sub-folders, docs, canvases and org-wide Lists at any depth follow the cut.",
    legacySource: "board.ts getBoardForReader checked only a List's direct Folder, and only its ownerId (board.ts:632-637).",
  },
  {
    id: "N3",
    mode: "strict",
    kind: "narrowing",
    text: "A canvas in a Private Folder follows the Folder.",
    legacySource: "whiteboard-gate.ts whiteboardSpaceVisible read the canvas's Space only.",
  },
  {
    id: "N4",
    mode: "strict",
    kind: "narrowing",
    text: "A doc on a Private List or on one of its tasks follows the List.",
    legacySource: "doc-access.ts:27-39 boardReadableWithFolder also admitted readers of the List's Folder.",
  },
  {
    id: "N5",
    mode: "strict",
    kind: "narrowing",
    text: "Sub-pages follow their parent page (A6). Under the legacy rule a page made before the workspace's cutoff keeps today's reach; one made after follows its parent from the start.",
    legacySource: "doc-access.ts:46 opened every doc with no anchor to the whole org.",
  },
  {
    id: "N6",
    mode: "strict",
    kind: "narrowing",
    text: "A Private List inside a granted Folder: the Folder grant no longer reaches it.",
    legacySource: "board.ts:700-716 getBoardForReaderOrFolderGrantee admitted it on the List page and its settings.",
  },
  {
    id: "N7",
    mode: "strict",
    kind: "narrowing",
    text: "Owner without reach: the owner of a Folder or List that is not Private, who no longer reaches its parent, loses it.",
    legacySource: "parity.ts legacyFolderReadable admitted a Folder's owner at any visibility (folder.ts:185).",
  },
  {
    id: "M1",
    mode: "always",
    kind: "information",
    text: "A node the viewer cannot open is never listed, named or counted: tree rows, doc titles in /docs and search, Space counts, rosters, crumbs, pickers, activity chips and the home activity feed.",
    legacySource: "spaces/[id]/children, /api/spaces counts, /api/docs and search listed rows without a per-row gate.",
  },
  {
    id: "M2",
    mode: "always",
    kind: "api",
    text: "API holes closed: uploads into a container the viewer does not reach, sub-pages under an unreadable parent, doc moves to unknown anchor types or unreadable parents, doc comments without the doc's role, the people picker's Guest filter. Moving a canvas to the Trash below Can edit is kept for today's readers (the legacy floor) and not given to new grants.",
    legacySource: "api/files POST, api/docs POST and PUT, api/item-updates, api/whiteboards/[id] DELETE, api/people/pick.",
  },
  {
    id: "M3",
    mode: "always",
    kind: "api",
    text: "Moves: a role that comes only from a grant on a canvas or a table never moves it; a sub-page leaves a restricted page tree only with Full access; a doc or a canvas leaves every place (which opens it to the whole org) only with Full access on it and on the Space it leaves (M6), never on a Can edit grant.",
    legacySource: "api/whiteboards/[id] and api/tables/[id] PATCH read the Space only; api/docs/[id] PUT read the page role.",
  },
  {
    id: "M4",
    mode: "always",
    kind: "api",
    text: "A stale doc sharing client that sends a changed members map is refused and asked to reload.",
    legacySource: "api/docs/[id]/sharing PATCH replaced the whole members map.",
  },
  {
    id: "M5",
    mode: "always",
    kind: "information",
    text: "A doc's public link address goes only to people who can change its sharing.",
    legacySource: "api/docs/[id]/sharing GET sent publicUrl to every reader.",
  },
  {
    id: "M6",
    mode: "always",
    kind: "api",
    text: "The placement rule (P1 to P7): making anything inside a container needs Can edit on it, so Can view and Can comment never create (a doc, a canvas or a table in a Space, a sub-page, a file in a Folder, a form's destination, a restore); a move needs Full access on the node and on the container it leaves (and on its Space when it leaves every Space for the org root) and Can edit where it goes, so a Space member who only edits no longer moves a doc, a canvas or a table out of where it is; a node's Space always comes from its parent, and a Folder moves or goes to Trash with its whole subtree. Org admins, Space managers and the Full holders of both ends keep what they had.",
    legacySource: "api/docs POST and PUT, api/whiteboards POST and PATCH, api/tables POST and PATCH, api/forms POST and PATCH read Can view, the creator or nothing; api/folders/reorder, PATCH api/folders/[id] and PATCH api/boards/[id] wrote a parent without its Space; the Folder Trash took its direct Lists only.",
  },
  {
    id: "C1",
    mode: "always",
    kind: "information",
    text: "Grants made by this release follow the new rules alone: a Space, Folder or List row written at or after the workspace's cutoff gets no older-rule reach, so a Folder grant never reaches a Private item inside it that does not name the person (A2). Rows written before the cutoff keep theirs (A8).",
    legacySource: "Every FolderMember row reached every List under its Folder (board.ts:700-716), a Private one included.",
  },
  {
    id: "C2",
    mode: "always",
    kind: "information",
    text: "A Can view role on a Space, Folder or List written at or after the workspace's cutoff gives Can view on the docs inside and their sub-pages, so it never edits or shares them (A5). Rows from before the cutoff and the org-wide reach keep today's Can edit (A8).",
    legacySource: "doc-access.ts resolveDocRole gave every reader of an unrestricted doc Can edit, and Can edit changes its sharing.",
  },
  {
    id: "C3",
    mode: "always",
    kind: "information",
    text: "A Can view role on a Space written at or after the workspace's cutoff gives Can view on the tables in it, so it never adds rows or columns, imports into them or points a form at them (A5). Rows from before the cutoff and the org-wide reach keep today's Can edit (A8).",
    legacySource: "api/tables/[id] and its rows and import routes let every reader of the table's Space write to it.",
  },
  {
    id: "W1",
    mode: "always",
    kind: "widening",
    text: "A Folder grant gives its Lists and tasks, docs, canvases and sub-folders per its role.",
    legacySource: "getBoardForReader and canContributeBoard never read FolderMember.",
  },
  {
    id: "W2",
    mode: "always",
    kind: "widening",
    text: "Full access on a Folder manages it; Can edit on a Folder or a Space makes Lists, sub-folders, docs and canvases in it (and tables at a Space root), the placement rule's P1.",
    legacySource: "POST /api/boards and /api/folders needed canEditSpace.",
  },
  {
    id: "W3",
    mode: "always",
    kind: "widening",
    text: "Full access on a List (a BoardMember Owner or Admin row) manages a List that is not Private.",
    legacySource: "board.ts canEditBoard read the List row only on a Private List.",
  },
  {
    id: "W4",
    mode: "always",
    kind: "widening",
    text: "Grants pierce: a doc listing opens the doc without its anchor; table, canvas and form grants open their object.",
    legacySource: "doc-access.ts docAccessible ran before the listing was read.",
  },
  {
    id: "W5",
    mode: "always",
    kind: "widening",
    text: "Full access on a Space or Folder gives Full access on the docs, tables and canvases inside.",
    legacySource: "doc-sharing.ts isDocFull and object-manage.ts named only the creator and org admins.",
  },
  {
    id: "W6",
    mode: "always",
    kind: "widening",
    text: "Grants never cut: a List grant or a List's owner opens the List inside someone else's Private Folder.",
    legacySource: "board.ts:632-637 hid every List inside a Private Folder the viewer did not own.",
  },
  {
    id: "W7",
    mode: "always",
    kind: "widening",
    text: "Path containers name the Space and Folders above a granted node.",
    legacySource: "spaces/[id]/children lifted granted Folders to the top of a bare Space.",
  },
  {
    id: "W8",
    mode: "always",
    kind: "widening",
    text: "A table grant counts as reach for the responses of a form that feeds that table.",
    legacySource: "forms/responder-access.ts read the table's Space only.",
  },
];
